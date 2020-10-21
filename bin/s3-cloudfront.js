/* eslint-disable no-new */
const cdk = require('@aws-cdk/core');

const { S3CloudFrontStack } = require('../lib/s3-cloudfront-stack');
const options = require('../lib/options.json');

const app = new cdk.App();

const { svcName } = options;

// Use account details from options.json or the default profile:
const account = (options.account) || process.env.CDK_DEFAULT_ACCOUNT;
const region = (options.region) || process.env.CDK_DEFAULT_REGION;

const env = {
    account,
    region,
    svcName,
};

new S3CloudFrontStack(app, 'S3CloudFrontStack', {
    description: 'S3 CloudFront Demo Stack',
    env,
});
