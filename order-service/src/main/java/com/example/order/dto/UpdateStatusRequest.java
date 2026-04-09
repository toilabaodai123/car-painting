package com.example.order.dto;

public record UpdateStatusRequest(Long orderId, String status, String stripeSessionId) {}
