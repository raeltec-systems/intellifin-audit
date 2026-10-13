# Internal ALB in the private app subnets. It has no public address; the only
# path to it from outside the VPC is the CloudFront VPC origin. Plain HTTP is
# used inside AWS because an ALB certificate needs a custom domain the owner
# does not have yet (see the 20.7a spec design notes).

resource "aws_lb" "api" {
  #checkov:skip=CKV_AWS_91:ALB access logs need a log bucket and are a cost decision; 20.7a ships the smallest profile and VPC flow logs record rejected traffic
  #checkov:skip=CKV2_AWS_20:internal ALB has no HTTPS listener to redirect to: CloudFront terminates TLS and reaches it only through the VPC origin
  name                       = "${local.name}-api"
  internal                   = true
  load_balancer_type         = "application"
  subnets                    = aws_subnet.app[*].id
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = true
  idle_timeout               = 60

  tags = { Name = "${local.name}-api" }
}

resource "aws_lb_target_group" "api" {
  #checkov:skip=CKV_AWS_378:targets are private API tasks in the same VPC behind the internal ALB; TLS terminates at CloudFront
  name                 = "${local.name}-api"
  port                 = 4310
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.this.id
  deregistration_delay = 30

  health_check {
    path                = "/health/ready"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${local.name}-api" }
}

resource "aws_lb_listener" "http" {
  #checkov:skip=CKV_AWS_2:HTTP inside AWS between the CloudFront VPC origin and the internal ALB; an ALB certificate needs a custom domain the owner does not have yet (spec design note)
  #checkov:skip=CKV_AWS_103:no TLS on this internal listener for the same reason; viewer TLS is enforced at CloudFront
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}
