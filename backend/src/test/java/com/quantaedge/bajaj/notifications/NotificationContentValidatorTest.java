package com.quantaedge.bajaj.notifications;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class NotificationContentValidatorTest {
  private ObjectMapper mapper;
  private NotificationContentValidator validator;

  @BeforeEach
  void setUp() {
    mapper = new ObjectMapper();
    validator = new NotificationContentValidator(mapper);
  }

  @Test
  void acceptsAndCanonicalizesVersionOneDocument() throws Exception {
    JsonNode result = validator.validate(mapper.readTree("""
        {"version":"1","blocks":[{"type":"hero","title":"Service update"}]}
        """));
    assertThat(result.path("version").intValue()).isEqualTo(1);
    assertThat(result.path("blocks")).hasSize(1);
  }

  @Test
  void rejectsUnsupportedBlockType() throws Exception {
    JsonNode input = mapper.readTree("""
        {"version":1,"blocks":[{"type":"script","body":"run"}]}
        """);
    assertThatThrownBy(() -> validator.validate(input))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("Unsupported notification block type");
  }

  @Test
  void rejectsExecutableMarkupProperties() throws Exception {
    JsonNode input = mapper.readTree("""
        {"version":1,"blocks":[{"type":"richText","html":"<script>alert(1)</script>"}]}
        """);
    assertThatThrownBy(() -> validator.validate(input))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("Executable HTML");
  }

  @Test
  void rejectsUnsafeCtaDestination() throws Exception {
    JsonNode input = mapper.readTree("""
        {"version":1,"blocks":[{"type":"cta","label":"Book now","target":"javascript:alert(1)"}]}
        """);
    assertThatThrownBy(() -> validator.validate(input))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("Unsafe URL");
  }

  @Test
  void requiresAlternativeTextForMeaningfulImage() throws Exception {
    JsonNode input = mapper.readTree("""
        {"version":1,"blocks":[{"type":"image","assetId":"asset-1"}]}
        """);
    assertThatThrownBy(() -> validator.validate(input))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("alternative text");
  }
}
