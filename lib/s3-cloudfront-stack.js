/* eslint-disable no-new */
const cdk = require('@aws-cdk/core');
const { Tags, CfnOutput } = require('@aws-cdk/core');
const route53 = require('@aws-cdk/aws-route53');
const acm = require('@aws-cdk/aws-certificatemanager');
const targets = require('@aws-cdk/aws-route53-targets');
const s3 = require('@aws-cdk/aws-s3');
const s3deploy = require('@aws-cdk/aws-s3-deployment');
const cf = require('@aws-cdk/aws-cloudfront');
const waf = require('@aws-cdk/aws-wafv2');
const options = require('./options.json');

class S3CloudFrontStack extends cdk.Stack {
    /**
     * A stack to deploy an S3 website behind CloudFront, with optional custom domain and WAF ACL
     * @param {cdk.Construct} scope
     * @param {string} id
     * @param {cdk.StackProps=} props
     */
    constructor(scope, id, props) {
        super(scope, id, props);
        const { region } = props.env;

        // Tag all resources with common service name
        Tags.of(this).add('Service', options.svcName);

        // ACM ===============================================

        /*
        * Create or use a custom certificate for the web site.
        * To keep it very simple you can just use the CloudFront generated hostname, and not create or
        * use a custom certificate.
        */

        const {
            useCustomDomain, rootDomain, createCert, certArn,
        } = options;

        if (useCustomDomain && !createCert && !certArn) {
            throw new Error('Using a custom domain requires either createCert or an existing Certificate ARN');
        }

        let acmCert = {};
        if (useCustomDomain) {
            /*
            * We can create an ACM certificate here, or use an existing certificate.
            * To create a certificate you must have previously prepared ACM to use DNS
            * verification - you must add the ACM verification text record to the DNS zone.
            * Also note that you can only create 20 certificates per year per region by default,
            * so don't deploy and destroy certificates frequently while testing.
            */
            if (createCert) {
                if (region !== 'us-east-1') { throw new Error('Stack must be deployed in us-east-1 to create a new Certificate'); }
                acmCert = new acm.Certificate(this, 'cfCert', {
                    domainName: `*.${rootDomain}`,
                    validation: acm.CertificateValidation.fromDns(),
                });
            }

            /*
            * Alternatively use an existing wildcard certificate for the domain.
            * The certificate must be in the us-east-1 region.
            */
            if (!createCert) { acmCert = acm.Certificate.fromCertificateArn(this, 'rootCfCertficate', certArn); }
        }

        // S3 ================================================

        /*
        * The S3 bucket can only be accesses via the CloudFront distribution.
        * Note when you destroy the stack, the bucket will not be deleted.
        * We cannot automatically delete it as it will not be empty.
        */
        const webBucket = new s3.Bucket(this, 'webBucket', {
            versioned: false,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        });
        const oia = new cf.OriginAccessIdentity(this, 'oai', {
            comment: 'Web Demo CF Distribution',
        });
        webBucket.grantRead(oia);

        // WAF ===============================================

        /*
        * We can create a WAF ACL to restrict traffic to our
        * test IP ranges. Access to the test site will be
        * blocked from all other IP's.
        * The WAF ACL must be created in us-east-1 to be used with
        */

        const { createWafAcl, allowCidrs } = options;
        let webAcl = {};
        if (createWafAcl) {
            /*
            * There are no L2 CDK constructs for WAF, so we are using
            * the Cfn constructs.
            */

            if (!Array.isArray(allowCidrs) || !allowCidrs.length) { throw new Error('We are expecting an array of CIDR addresses for the allowCidr list'); }
            if (region !== 'us-east-1') { throw new Error('Stack must be deployed in us-east-1 to create the WAF ACL'); }

            // IP address set for our whitelisted CIDR's
            const ipSet = new waf.CfnIPSet(this, 'ipSet', {
                name: 'webDemoAllowCidrs',
                description: 'Web Demo Allowed addresses',
                ipAddressVersion: 'IPV4',
                addresses: allowCidrs,
                scope: 'CLOUDFRONT',
            });

            // Custom WAF Rule Group with the IP address whitelist Rule
            const rules = new waf.CfnRuleGroup(this, 'wafRules', {
                name: 'webDemoRuleGroup',
                capacity: 1,
                scope: 'CLOUDFRONT',
                visibilityConfig: {
                    cloudWatchMetricsEnabled: false,
                    metricName: 'rulesWebDemo',
                    sampledRequestsEnabled: false,
                },
                rules: [
                    {
                        name: 'allowTestIps',
                        action: {
                            allow: {},
                        },
                        priority: 0,
                        statement: {
                            ipSetReferenceStatement: {
                                arn: ipSet.attrArn,
                            },
                        },
                        visibilityConfig: {
                            cloudWatchMetricsEnabled: false,
                            metricName: 'ruleWebDemo',
                            sampledRequestsEnabled: false,
                        },
                    },
                ],
            });

            // WAF ACL to be associated with CloudFront
            webAcl = new waf.CfnWebACL(this, 'webAcl', {
                description: 'Web Demo ACL',
                defaultAction: {
                    block: {},
                },
                visibilityConfig: {
                    cloudWatchMetricsEnabled: false,
                    metricName: 'aclWebDemo',
                    sampledRequestsEnabled: false,
                },
                scope: 'CLOUDFRONT',
                rules: [
                    {
                        name: 'webDemoRules',
                        priority: 1,
                        statement: {
                            ruleGroupReferenceStatement: {
                                arn: rules.attrArn,
                            },
                        },
                        visibilityConfig: {
                            cloudWatchMetricsEnabled: false,
                            metricName: 'ruleJtrb',
                            sampledRequestsEnabled: false,
                        },
                        overrideAction: {
                            none: {},
                        },
                    },
                ],
            });
            new CfnOutput(this, 'webAclId', {
                exportName: 'webDemoAclId',
                description: 'Web Demo ACL Id',
                value: webAcl.attrId,
            });
        }

        // CloudFront ========================================

        const { hostname } = options;

        // common props for the distribution
        const distDefOptions = {
            originConfigs: [
                {
                    s3OriginSource: {
                        s3BucketSource: webBucket,
                        originAccessIdentity: oia,
                    },
                    behaviors: [{ isDefaultBehavior: true }],
                },
            ],
        };

        // props required for the custom domain and certificate
        const certOptions = {
            viewerCertificate: cf.ViewerCertificate.fromAcmCertificate(acmCert, {
                aliases: [`${hostname}.${rootDomain}`],
                securityPolicy: cf.SecurityPolicyProtocol.TLS_V1_2_2019,
            }),
        };

        // props required for the WAF ACL
        const aclOptions = {
            webACLId: webAcl.attrArn,
        };

        const certProps = (useCustomDomain) ? { ...distDefOptions, ...certOptions } : { ...distDefOptions };
        const distProps = (createWafAcl) ? { ...certProps, ...aclOptions } : { ...certProps };

        const webDemoDist = new cf.CloudFrontWebDistribution(this, 'webDemoDist', distProps);
        new CfnOutput(this, 'cfWebUrl', {
            exportName: 'cfWebUrl',
            value: `https://${webDemoDist.distributionDomainName}`,
            description: 'Web Demo CloudFront URL',
        });

        // DNS ==============================================

        const { createDns } = options;

        // We can create a DNS alias if the domain is hosted in Route53.

        if (useCustomDomain && createDns) {
            const zone = route53.HostedZone.fromLookup(this, 'zone', {
                domainName: rootDomain,
            });

            new route53.ARecord(this, 'cfAlias', {
                target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(webDemoDist)),
                zone,
                recordName: `${hostname}.${rootDomain}`,
            });

            new CfnOutput(this, 'customWebUrl', {
                exportName: 'customWebDemoUrl',
                value: `https://${hostname}.${rootDomain}`,
                description: 'Web Demo Custom URL',
            });
        }

        // Deploy Files ======================================

        /*
        * This will upload everything from the web folder to the S3 bucket.
        * If you update anything in the web folder and run cdk deploy,
        * the new files will be copied to the bucket, and the CloudFront
        * cache will be invalidated to make the new content available instantly
        */

        new s3deploy.BucketDeployment(this, 'webAssets', {
            sources: [s3deploy.Source.asset(`${__dirname}/web`)],
            destinationBucket: webBucket,
            // invalidate the cache on deploying new web assets:
            distribution: webDemoDist,
            distributionPaths: ['/'],
        });
    }
}

module.exports = { S3CloudFrontStack };
