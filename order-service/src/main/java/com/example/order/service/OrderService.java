package com.example.order.service;

import com.example.order.dto.CreateOrderRequest;
import com.example.order.dto.OrderAggregateResponse;
import com.example.order.dto.OrderResponse;
import com.example.order.dto.UpdateStatusRequest;
import com.example.order.model.Order;
import com.example.order.model.OrderStatus;
import com.example.order.repository.OrderRepository;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

@Service
public class OrderService {

    private final OrderRepository repository;
    private final KafkaTemplate<String, String> kafkaTemplate;

    public OrderService(OrderRepository repository, KafkaTemplate<String, String> kafkaTemplate) {
        this.repository = repository;
        this.kafkaTemplate = kafkaTemplate;
    }

    /**
     * List all orders as DTOs.
     */
    public List<OrderResponse> getAllOrders() {
        return repository.findAll().stream()
                .map(OrderResponse::from)
                .collect(Collectors.toList());
    }

    /**
     * Aggregated view for admin — orders + cross-service user/product data.
     * The cross-service data is passed in by the caller (Kafka handler or controller).
     */
    public OrderAggregateResponse getAggregated(Object usersData, Object productsData) {
        List<OrderResponse> orders = getAllOrders();
        return new OrderAggregateResponse(orders, usersData, productsData);
    }

    /**
     * Create a new order in PENDING state.
     */
    public OrderResponse createOrder(CreateOrderRequest request) {
        Order order = new Order(request.userId(), request.productId());
        Order saved = repository.save(order);
        return OrderResponse.from(saved);
    }

    /**
     * Update order status with FSM validation.
     * Emits a Kafka event for real-time updates.
     */
    public OrderResponse updateStatus(UpdateStatusRequest request) {
        Order order = repository.findById(request.orderId())
                .orElseThrow(() -> new RuntimeException("Order not found: " + request.orderId()));

        OrderStatus newStatus = OrderStatus.valueOf(request.status());
        OrderStatus currentStatus = order.getStatus();

        // FSM transition validation
        if (!currentStatus.canTransitionTo(newStatus)) {
            throw new RuntimeException(
                "Invalid state transition: " + currentStatus + " → " + newStatus
            );
        }

        order.setStatus(newStatus);
        if (request.stripeSessionId() != null) {
            order.setStripeSessionId(request.stripeSessionId());
        }
        Order updated = repository.save(order);

        // Emit real-time event to the realtime-service via Kafka
        emitStatusEvent(updated);

        return OrderResponse.from(updated);
    }

    private void emitStatusEvent(Order order) {
        try {
            String eventJson = com.common.utils.JsonUtils.getMapper().writeValueAsString(
                java.util.Map.of(
                    "orderId", order.getId(),
                    "userId", order.getUserId(),
                    "productId", order.getProductId(),
                    "status", order.getStatus().name()
                )
            );
            kafkaTemplate.send("order-status-updates", eventJson);
            System.out.println("Emitted order status event: " + eventJson);
        } catch (Exception e) {
            System.err.println("Failed to emit order status event: " + e.getMessage());
        }
    }
}
