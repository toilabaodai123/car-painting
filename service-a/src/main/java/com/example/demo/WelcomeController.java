package com.example.demo;

import com.common.kafka.KafkaClient;
import com.common.message.Response;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

@RestController
public class WelcomeController {

    @Autowired
    private KafkaClient kafkaClient;

    @GetMapping("/")
    public Response welcome() {
        Map<String, String> info = new HashMap<>();
        info.put("message", "Welcome to Service A");
        info.put("projectName", "service-a");
        return Response.dataResponse(info);
    }

    @GetMapping("/call-b")
    public Response callServiceB() {
        try {
            Response responseB = kafkaClient.sendRequest("service-b-topic", "/call-b", null);
            Map<String, Object> info = new HashMap<>();
            info.put("message", "Service A called Service B successfully via Kafka");
            info.put("serviceBResponse", responseB);
            return Response.dataResponse(info);
        } catch (Exception e) {
            e.printStackTrace();
            return Response.systemErrorResponse("SERVICE_B_UNAVAILABLE");
        }
    }

    @GetMapping("/users")
    public Response getUsers() {
        try {
            Response responseUsers = kafkaClient.sendRequest("user-service-topic", "/users", null);
            Map<String, Object> info = new HashMap<>();
            info.put("message", "Fetched users from database via user-service");
            info.put("usersData", responseUsers);
            return Response.dataResponse(info);
        } catch (Exception e) {
            e.printStackTrace();
            return Response.systemErrorResponse("USER_SERVICE_UNAVAILABLE");
        }
    }

    @GetMapping("/users-node")
    public Response getUsersNode() {
        try {
            Response responseUsers = kafkaClient.sendRequest("user-service-node-topic", "/users-node", null);
            Map<String, Object> info = new HashMap<>();
            info.put("message", "Fetched users from database via Node.js user-service");
            info.put("usersData", responseUsers);
            return Response.dataResponse(info);
        } catch (Exception e) {
            e.printStackTrace();
            return Response.systemErrorResponse("USER_SERVICE_NODE_UNAVAILABLE");
        }
    }

    @GetMapping("/users-go")
    public Response getUsersGo() {
        try {
            Response responseUsers = kafkaClient.sendRequest("user-service-go-topic", "/users-go", null);
            Map<String, Object> info = new HashMap<>();
            info.put("message", "Fetched users from database via Golang user-service");
            info.put("usersData", responseUsers);
            return Response.dataResponse(info);
        } catch (Exception e) {
            e.printStackTrace();
            return Response.systemErrorResponse("USER_SERVICE_GO_UNAVAILABLE");
        }
    }
    @GetMapping("/all-users")
    public Response getAllUsers() {
        Map<String, Object> info = new HashMap<>();
        
        try {
            Response responseUsers = kafkaClient.sendRequest("user-service-topic", "/users", null);
            info.put("javaUsers", responseUsers);
        } catch (Exception e) {
            e.printStackTrace();
            info.put("javaUsersError", "USER_SERVICE_UNAVAILABLE");
        }

        try {
            Response responseNode = kafkaClient.sendRequest("user-service-node-topic", "/users-node", null);
            info.put("nodeUsers", responseNode);
        } catch (Exception e) {
            e.printStackTrace();
            info.put("nodeUsersError", "USER_SERVICE_NODE_UNAVAILABLE");
        }

        try {
            Response responseGo = kafkaClient.sendRequest("user-service-go-topic", "/users-go", null);
            info.put("goUsers", responseGo);
        } catch (Exception e) {
            e.printStackTrace();
            info.put("goUsersError", "USER_SERVICE_GO_UNAVAILABLE");
        }

        info.put("message", "Fetched all users from Java, Node.js, and Golang user-services");
        return Response.dataResponse(info);
    }
}
