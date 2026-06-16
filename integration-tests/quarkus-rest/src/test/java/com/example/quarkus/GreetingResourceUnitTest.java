package com.example.quarkus;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class GreetingResourceUnitTest {

    @Test
    void helloReturnsGreeting() {
        assertEquals("Hello from quarkus-rest", new GreetingResource().hello());
    }
}
