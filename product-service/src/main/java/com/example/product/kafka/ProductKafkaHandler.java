package com.example.product.kafka;

import com.common.kafka.KafkaClient;
import com.common.kafka.KafkaConfig;
import com.common.kafka.RequestHandler;
import com.example.product.service.ProductService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Thin Kafka adapter — delegates to ProductService.
 */
@Component
public class ProductKafkaHandler {

    private final RequestHandler requestHandler;

    @Autowired
    public ProductKafkaHandler(KafkaConfig config, KafkaClient kafkaClient, ProductService productService) {
        this.requestHandler = new RequestHandler(config, kafkaClient);

        requestHandler.handle("/products", msg -> {
            return productService.getAllProducts();
        });
    }

    @KafkaListener(topics = "product-service-topic", groupId = "product-service-group")
    public void listen(String payload) {
        requestHandler.dispatch(payload);
    }
}
