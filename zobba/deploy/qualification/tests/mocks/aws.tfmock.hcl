# Offline AWS: every test uses this mocked provider, so no credentials are
# read and no AWS API is called. Data sources get realistic fixed values.

mock_data "aws_caller_identity" {
  defaults = {
    account_id = "123456789012"
  }
}

mock_data "aws_partition" {
  defaults = {
    partition = "aws"
  }
}

mock_data "aws_availability_zones" {
  defaults = {
    names = ["eu-west-1a", "eu-west-1b", "eu-west-1c"]
  }
}

mock_data "aws_ec2_managed_prefix_list" {
  defaults = {
    id = "pl-4fa04526"
  }
}

mock_resource "aws_db_instance" {
  defaults = {
    address = "zobba-qualification.abcdefghijkl.eu-west-1.rds.amazonaws.com"
    port    = 5432
    master_user_secret = [{
      secret_arn    = "arn:aws:secretsmanager:eu-west-1:123456789012:secret:rds!db-mock-AbCdEf"
      secret_status = "active"
      kms_key_id    = "arn:aws:kms:eu-west-1:123456789012:key/mock"
    }]
  }
}

mock_resource "aws_cloudfront_distribution" {
  defaults = {
    domain_name = "d111111abcdef8.cloudfront.net"
    arn         = "arn:aws:cloudfront::123456789012:distribution/EDFDVBD6EXAMPLE"
  }
}

mock_resource "aws_kms_key" {
  defaults = {
    arn = "arn:aws:kms:eu-west-1:123456789012:key/11111111-2222-3333-4444-555555555555"
  }
}

mock_resource "aws_ecr_repository" {
  defaults = {
    repository_url = "123456789012.dkr.ecr.eu-west-1.amazonaws.com/zobba-qualification"
    arn            = "arn:aws:ecr:eu-west-1:123456789012:repository/zobba-qualification"
  }
}

mock_resource "aws_cognito_user_pool" {
  defaults = {
    id = "eu-west-1_Mock12345"
  }
}

mock_resource "aws_cognito_user_pool_client" {
  defaults = {
    id            = "mockclientid1234567890"
    client_secret = "mock-client-secret-value"
  }
}

mock_resource "aws_s3_bucket" {
  defaults = {
    arn = "arn:aws:s3:::zobba-qualification-mock"
  }
}

mock_resource "aws_cloudwatch_log_group" {
  defaults = {
    arn = "arn:aws:logs:eu-west-1:123456789012:log-group:/zobba-qualification/mock"
  }
}

mock_resource "aws_iam_role" {
  defaults = {
    arn = "arn:aws:iam::123456789012:role/zobba-qualification-mock"
  }
}

mock_resource "aws_ecs_cluster" {
  defaults = {
    arn = "arn:aws:ecs:eu-west-1:123456789012:cluster/zobba-qualification"
  }
}

mock_resource "aws_iam_openid_connect_provider" {
  defaults = {
    arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
  }
}

mock_resource "aws_lb" {
  defaults = {
    arn      = "arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/zobba-qualification-api/50dc6c495c0c9188"
    dns_name = "internal-zobba-qualification-api-1234567890.eu-west-1.elb.amazonaws.com"
  }
}

mock_resource "aws_lb_target_group" {
  defaults = {
    arn = "arn:aws:elasticloadbalancing:eu-west-1:123456789012:targetgroup/zobba-qualification-api/73e2d6bc24d8a067"
  }
}

mock_resource "aws_cloudfront_function" {
  defaults = {
    arn = "arn:aws:cloudfront::123456789012:function/zobba-qualification-mock"
  }
}

mock_resource "aws_secretsmanager_secret" {
  defaults = {
    arn = "arn:aws:secretsmanager:eu-west-1:123456789012:secret:zobba-qualification/mock-AbCdEf"
  }
}

mock_resource "aws_ecs_task_definition" {
  defaults = {
    arn = "arn:aws:ecs:eu-west-1:123456789012:task-definition/zobba-qualification-mock:1"
  }
}

mock_resource "aws_ecs_service" {
  defaults = {
    id = "arn:aws:ecs:eu-west-1:123456789012:service/zobba-qualification/zobba-qualification-mock"
  }
}

mock_data "aws_security_group" {
  defaults = {
    id   = "sg-0cf0vpcorigin00001"
    name = "CloudFront-VPCOrigins-Service-SG_abc123"
  }
}
