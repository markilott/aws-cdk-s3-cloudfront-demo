# AWS CDK S3 Website with CloudFront and WAF ACL

This Javascript CDK project creates an S3 bucket origin and CloudFront distribution.

Optionally create or use an ACM certificate and custom domain, and a WAF ACL to restrict access
to specific CIDR ranges.

I created this project as I had a need to demo static web sites and restrict access to specific
IP addresses.

The WAF configuation uses the L1 Cfn constructs as there are currently no L2 CDK constructs for WAF. It was
a bit of a challenge to get the syntax correct!

All of the resources created are free or within free tiers, except the WAF ACL which will cost approx $6/month.

## Setup

Assuming you have the AWS CLI installed and configured already...

If you also have the AWS CDK installed globally then you will need to update/install the modules for this project:
- Run `npm update -g`
- Run `npm i -g @aws-cdk/aws-route53 @aws-cdk/aws-certificatemanager @aws-cdk/aws-route53-targets @aws-cdk/aws-s3 @aws-cdk/aws-cloudfront @aws-cdk/aws-wafv2`

Setup the project:
- Clone the repo
- Run `npm install` (if you didn't run the global install above)
- Update the `options.json` file with your own environment details and preferences
- Run `cdk diff` or `cdk synth` to test
- Run `cdk deploy` to deploy the stack
- Open the url from the output to verify access to the web page

## Options

If you deploy without updating any of the options you will get:
- A stack deployed in us-east-1 in the AWS Account from your default CLI profile
- A CloudFront distribution in front of an s3 bucket with a basic index.html file
- No WAF ACL, custom domain or certificate

### Using a custom domain or certificate

You can keep it simple and use the default CloudFront domain name, or use a custom name and certificate.

A custom domain name requires:
- Route53 domain in the same account (or you can create the DNS CNAME yourself manually)
- ACM Certificate for the domain in the same account, in the `us-east-1` region (or we can create it)
- If you want to create the certificate, then the domain must have already been configured for ACM DNS verifiction.

If you are creating the certificate, then the stack must be deployed in `us-east-1`, as CloudFront can only use certificates
from this region. If you are specifying the ARN for an existing certificate, then it must be in `us-east-1`, but you can then deploy 
this stack anywhere (unless you also want the WAF ACL).

***Certificate Verification Tip:*** *To prepare a domain for ACM DNS verification, first creat a certificate manually in the console. You will be prompted to*
*add a CNAME record to the domain. You can delete the manual certificate after you have the CNAME, and future automated*
*certificate creation using CDK or CloudFormation will work.*

***Certificate Limits Tip:*** *There is a soft limit of 20 certificate creations per region per year. Don't create/destroy certificates too often*
*when testing stacks or you will soon hit the limit (yes I found this the hard way)*

### WAF ACL

You can create and apply a WAF ACL to restrict access to the web site to a whitelist of IP CIDR ranges. Specify the CIDR ranges
in an array in the `options.json`. eg `["8.8.8.8/32", "8.8.4.4/32"]` (don't use *"0.0.0.0/0"*).

If you are creating the WAF ACL the stack must be deployed in the `us-east-1` region, as this is required for it to be attached to
a CloudFront distribution.

### Account and Region

You can specify an Account number and Region in the `options.json`, or leave them blank and use the account and region from your AWS CLI profile.

Remember, you must use `us-east-1` to create a new Certificate or the WAF ACL.

## Web Files

Everything in the /lib/web folder will be uploaded to the s3 bucket and available via the web. The only requirement is that you include
an `index.html` file in the root.

Updating a file in the web folder then running `cdk deploy` will upload the new file(s) and invalidate all items in the
CloudFront cache. The changes will be visible immediately. Not a great idea for a large and busy site, but perfect for a demo.
