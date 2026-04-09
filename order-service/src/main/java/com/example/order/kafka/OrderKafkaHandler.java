package com.example.order.kafka;

import com.common.kafka.KafkaClient;
import com.common.kafka.KafkaConfig;
import com.common.kafka.RequestHandler;
import com.common.message.Response;
import com.example.order.dto.CreateOrderRequest;
import com.example.order.dto.OrderResponse;
import com.example.order.dto.UpdateStatusRequest;
import com.example.order.service.OrderService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * Thin Kafka adapter — parses messages into DTOs and delegates to OrderService.
 */
@Component
public class OrderKafkaHandler {

    private final RequestHandler requestHandler;
    private final KafkaClient kafkaClient;

    @Autowired
    public OrderKafkaHandler(KafkaConfig config, KafkaClient kafkaClient, OrderService orderService) {
        this.kafkaClient = kafkaClient;
        this.requestHandler = new RequestHandler(config, kafkaClient);

        // GET all orders (aggregated with users + products via Kafka cross-service calls)
        requestHandler.handle("/orders", msg -> {
            Object usersData = null;
            Object productsData = null;
            try {
                Response userResponse = kafkaClient.sendRequest("user-service-topic", "/users", null);
                usersData = userResponse.getData();
            } catch (Exception e) {
                usersData = "Error fetching users: " + e.getMessage();
            }
            try {
                Response productResponse = kafkaClient.sendRequest("product-service-topic", "/products", null);
                productsData = productResponse.getData();
            } catch (Exception e) {
                productsData = "Error fetching products: " + e.getMessage();
            }
            return orderService.getAggregated(usersData, productsData);
        });

        // CREATE order → parses Map into DTO
        requestHandler.handle("/orders/create", msg -> {
            Map<String, Object> data = (Map<String, Object>) msg.getData();
            CreateOrderRequest request = new CreateOrderRequest(
                Long.valueOf(data.get("userId").toString()),
                Long.valueOf(data.get("productId").toString())
            );
            return orderService.createOrder(request);
        });

        // UPDATE order status → parses Map into DTO
        requestHandler.handle("/orders/update-status", msg -> {
            Map<String, Object> data = (Map<String, Object>) msg.getData();
            UpdateStatusRequest request = new UpdateStatusRequest(
                Long.valueOf(data.get("orderId").toString()),
                data.get("status").toString(),
                data.containsKey("stripeSessionId") ? data.get("stripeSessionId").toString() : null
            );
            return orderService.updateStatus(request);
        });
    }

    @KafkaListener(topics = "order-service-topic", groupId = "order-service-group")
    public void listen(String payload) {
        requestHandler.dispatch(payload);
    }

    @KafkaListener(topics = "e-commerce.response.order-service", groupId = "order-service-resp-group")
    public void listenResponse(String payload) {
        try {
            com.common.message.Message msg = com.common.utils.JsonUtils.getMapper()
                .readValue(payload, com.common.message.Message.class);
            kafkaClient.handleResponse(msg);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
