package com.example.failing;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

// Deliberately mixed suite: one passing test, one assertion FAILURE and one
// ERROR (uncaught exception). It exists so Coffilot's report discovery + parser
// (collectSurefireReport / parseSurefireSuiteXml) is exercised against a real
// Surefire report that contains failures and errors, not just green runs.
class CalculatorTest {

    @Test
    void addsTwoNumbers() {
        assertEquals(5, new Calculator().add(2, 3));
    }

    @Test
    void failsOnPurpose() {
        // Wrong expectation on purpose -> recorded as a <failure> in the report.
        assertEquals(42, new Calculator().add(2, 3), "add should equal 42 (intentionally wrong)");
    }

    @Test
    void errorsOnPurpose() {
        // Division by zero throws -> recorded as an <error> in the report.
        new Calculator().divide(1, 0);
    }
}
