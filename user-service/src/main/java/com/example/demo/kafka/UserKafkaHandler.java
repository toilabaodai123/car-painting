package com.example.demo.kafka;

import com.common.kafka.KafkaClient;
import com.common.kafka.KafkaConfig;
import com.common.kafka.RequestHandler;
import com.example.demo.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Thin Kafka adapter — delegates to UserService.
 */
@Component
public class UserKafkaHandler {

    private final RequestHandler requestHandler;

    @Autowired
    public UserKafkaHandler(KafkaConfig config, KafkaClient kafkaClient, UserService userService) {
        this.requestHandler = new RequestHandler(config, kafkaClient);

        requestHandler.handle("/users", msg -> {
            return userService.getAllUsers();
        });

        requestHandler.handle("/users/register", msg -> {
            try {
                com.example.demo.dto.CreateUserRequest request = 
                    com.common.utils.JsonUtils.getMapper().convertValue(msg.getData(), com.example.demo.dto.CreateUserRequest.class);
                return userService.createUser(request);
            } catch (Exception e) {
                throw new RuntimeException("Failed to decode CreateUserRequest", e);
            }
        });
    }

    @KafkaListener(topics = "user-service-topic", groupId = "user-service-group")
    public void listen(String payload) {
        requestHandler.dispatch(payload);
    }
}
