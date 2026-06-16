package com.example.quarkus;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.is;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

@QuarkusTest
class GreetingResourceTest {

    @Test
    void respondsWithGreeting() {
        given().when().get("/").then().statusCode(200).body(is("Hello from quarkus-rest"));
    }
}
