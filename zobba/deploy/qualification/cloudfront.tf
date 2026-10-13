# Single public origin. CloudFront serves the built web shell from the private
# web bucket and sends /api/* to the internal ALB through a VPC origin. A
# CloudFront Function removes the /api prefix exactly as the development proxy
# does (zobba/web/vite.config.ts), so the API sees /auth/callback, /health/...

resource "aws_cloudfront_vpc_origin" "api" {
  vpc_origin_endpoint_config {
    name                   = "${local.name}-api"
    arn                    = aws_lb.api.arn
    http_port              = 80
    https_port             = 443
    origin_protocol_policy = "http-only"

    origin_ssl_protocols {
      items    = ["TLSv1.2"]
      quantity = 1
    }
  }

  tags = { Name = "${local.name}-api" }
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${local.name}-web"
  description                       = "Web shell bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "strip_api_prefix" {
  name    = "${local.name}-strip-api-prefix"
  runtime = "cloudfront-js-2.0"
  comment = "Remove the /api prefix before the request reaches the API"
  publish = true
  code    = file("${path.module}/functions/strip-api-prefix.js")
}

resource "aws_cloudfront_function" "web_routes" {
  name    = "${local.name}-web-routes"
  runtime = "cloudfront-js-2.0"
  comment = "Serve index.html for client-side routes"
  publish = true
  code    = file("${path.module}/functions/web-routes.js")
}

locals {
  web_origin_id = "web"
  api_origin_id = "api"

  # AWS managed policies (stable IDs documented by CloudFront).
  cache_policy_caching_disabled  = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  cache_policy_caching_optimized = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  origin_request_all_except_host = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
}

# Security headers on every response. `override = false` keeps any stricter
# value the API itself sets.
resource "aws_cloudfront_response_headers_policy" "security" {
  name    = "${local.name}-security"
  comment = "Security headers for the web shell and API"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = false
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = false
    }
  }
}

resource "aws_cloudfront_distribution" "this" {
  #checkov:skip=CKV_AWS_68:WAF is a recurring cost outside the smallest profile; owner decision before any real data (RUNBOOK owner gates)
  #checkov:skip=CKV2_AWS_47:no WAF attached (see CKV_AWS_68 reason)
  #checkov:skip=CKV_AWS_86:CloudFront standard logs need a log bucket and are a cost decision; enable before real data
  #checkov:skip=CKV_AWS_374:no geographic restriction is specified for qualification; access is controlled by Cognito sign-in and membership
  #checkov:skip=CKV_AWS_310:a single API origin by design; origin failover would need a second region
  #checkov:skip=CKV_AWS_174:the default CloudFront certificate (no custom domain yet) only allows TLSv1 as minimum; a custom domain sets TLSv1.2_2021
  enabled             = true
  comment             = local.name
  default_root_object = "index.html"
  http_version        = "http2and3"
  price_class         = "PriceClass_100"
  is_ipv6_enabled     = true
  aliases             = var.custom_domain == null ? [] : [var.custom_domain]

  origin {
    origin_id                = local.web_origin_id
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  origin {
    origin_id   = local.api_origin_id
    domain_name = aws_lb.api.dns_name

    vpc_origin_config {
      vpc_origin_id            = aws_cloudfront_vpc_origin.api.id
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }
  }

  default_cache_behavior {
    target_origin_id           = local.web_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.cache_policy_caching_optimized
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.web_routes.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = local.api_origin_id
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = false
    cache_policy_id            = local.cache_policy_caching_disabled
    origin_request_policy_id   = local.origin_request_all_except_host
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.strip_api_prefix.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.custom_domain == null
    acm_certificate_arn            = var.custom_domain_certificate_arn
    ssl_support_method             = var.custom_domain == null ? null : "sni-only"
    minimum_protocol_version       = var.custom_domain == null ? "TLSv1" : "TLSv1.2_2021"
  }

  tags = { Name = local.name }
}
