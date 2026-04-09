package com.example.product.dto;

public record ProductResponse(Long id, String name, Double price) {

    public static ProductResponse from(com.example.product.model.Product product) {
        return new ProductResponse(product.getId(), product.getName(), product.getPrice());
    }
}
