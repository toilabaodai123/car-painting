package com.example.order.dto;

import java.util.List;

public record OrderAggregateResponse(
    List<OrderResponse> orders,
    Object users,
    Object products
) {}
