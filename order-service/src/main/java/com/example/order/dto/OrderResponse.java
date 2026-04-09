package com.example.order.dto;

public record OrderResponse(Long id, Long userId, Long productId, String status) {

    public static OrderResponse from(com.example.order.model.Order order) {
        return new OrderResponse(
            order.getId(),
            order.getUserId(),
            order.getProductId(),
            order.getStatus().name()
        );
    }
}
