import { BlockPublicAccess, Bucket, BucketEncryption, StorageClass } from "@aws-cdk/aws-s3";
import { CfnOutput, Duration, Fn, Stack } from "@aws-cdk/core";
import { FromSchema } from "json-schema-to-ts";
import { AwsProvider } from "./Provider";
import { AwsComponent } from "./AwsComponent";
import { PolicyStatement } from "../Stack";

export const STORAGE_DEFINITION = {
    type: "object",
    properties: {
        type: { const: "storage" },
        archive: { type: "number", minimum: 30 },
        encryption: {
            anyOf: [{ const: "s3" }, { const: "kms" }],
        },
    },
    additionalProperties: false,
} as const;
const STORAGE_DEFAULTS = {
    archive: 45,
    encryption: "s3",
};

export class Storage extends AwsComponent<typeof STORAGE_DEFINITION> {
    private readonly bucket: Bucket;
    private readonly bucketNameOutput: CfnOutput;

    constructor(provider: AwsProvider, id: string, configuration: FromSchema<typeof STORAGE_DEFINITION>) {
        const resolvedConfiguration = Object.assign({}, STORAGE_DEFAULTS, configuration);

        super(provider, id, resolvedConfiguration);

        const encryptionOptions = {
            s3: BucketEncryption.S3_MANAGED,
            kms: BucketEncryption.KMS_MANAGED,
        };

        this.bucket = new Bucket(this.cdkNode, "Bucket", {
            encryption: encryptionOptions[resolvedConfiguration.encryption],
            versioned: true,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            lifecycleRules: [
                {
                    transitions: [
                        {
                            storageClass: StorageClass.INTELLIGENT_TIERING,
                            transitionAfter: Duration.days(0),
                        },
                    ],
                },
                {
                    noncurrentVersionExpiration: Duration.days(30),
                },
            ],
        });

        this.bucketNameOutput = new CfnOutput(this.cdkNode, "BucketName", {
            value: this.bucket.bucketName,
        });
    }

    permissions(): PolicyStatement[] {
        return [
            new PolicyStatement(
                ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"],
                [
                    this.referenceBucketArn(),
                    // @ts-expect-error join only accepts a list of strings, whereas other intrinsic functions are commonly accepted
                    Stack.of(this.cdkNode).resolve(Fn.join("/", [this.referenceBucketArn(), "*"])),
                ]
            ),
        ];
    }

    /**
     * serverless info
     *     storage: bucket-name
     */
    async infoOutput(): Promise<string | undefined> {
        return await this.getBucketName();
    }

    public variables(): Record<string, () => Promise<string | undefined>> {
        return {
            bucketName: () => this.getBucketName(),
        };
    }

    references(): Record<string, () => Record<string, unknown>> {
        return {
            bucketArn: () => this.referenceBucketArn(),
        };
    }

    referenceBucketArn(): Record<string, unknown> {
        return this.getCloudFormationReference(this.bucket.bucketArn);
    }

    async getBucketName(): Promise<string | undefined> {
        return this.getOutputValue(this.bucketNameOutput);
    }
}
