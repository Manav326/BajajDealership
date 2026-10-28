package com.quantaedge.bajaj.notifications;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;
import org.springframework.stereotype.Component;

/** Validates provider-neutral notification JSON inspired by QuantaEdge Notification Studio. */
@Component
public class NotificationContentValidator {
  private static final Set<String> BLOCK_TYPES = Set.of(
      "hero", "richText", "image", "video", "animation", "vehicleCard",
      "serviceCard", "highlight", "badge", "icon", "divider", "spacer",
      "cta", "footer", "container", "carousel");
  private static final Set<String> UNSAFE_KEYS = Set.of(
      "html", "rawhtml", "script", "javascript", "onclick", "onerror",
      "srcdoc", "iframe", "dangerouslysetinnerhtml");
  private static final int MAX_BLOCKS = 40;
  private static final int MAX_NODES = 800;
  private static final int MAX_DEPTH = 12;
  private static final int MAX_TEXT_LENGTH = 5_000;
  private static final int MAX_DOCUMENT_BYTES = 128 * 1024;

  private final ObjectMapper mapper;

  public NotificationContentValidator(ObjectMapper mapper) {
    this.mapper = mapper;
  }

  public JsonNode validate(Object rawDocument) {
    if (rawDocument == null) {
      throw new IllegalArgumentException("Notification content is required.");
    }
    JsonNode source = mapper.valueToTree(rawDocument);
    if (source == null || !source.isObject()) {
      throw new IllegalArgumentException("Notification content must be a JSON object.");
    }

    JsonNode version = source.path("version");
    boolean supported = version.isIntegralNumber() && version.intValue() == 1;
    if (version.isTextual()) {
      supported = "1".equals(version.asText().trim());
    }
    if (!supported) {
      throw new IllegalArgumentException("Unsupported notification content version.");
    }

    JsonNode sourceBlocks = source.path("blocks");
    if (!sourceBlocks.isArray() || sourceBlocks.isEmpty() || sourceBlocks.size() > MAX_BLOCKS) {
      throw new IllegalArgumentException("Add between 1 and 40 notification content blocks.");
    }

    JsonNode document = source.deepCopy();
    ((ObjectNode) document).put("version", 1);
    validateTree(document, 0, new int[] {0});
    validateBlockRequirements(document.path("blocks"));

    try {
      if (mapper.writeValueAsBytes(document).length > MAX_DOCUMENT_BYTES) {
        throw new IllegalArgumentException("Notification content exceeds the 128 KiB limit.");
      }
    } catch (java.io.IOException exception) {
      throw new IllegalArgumentException("Notification content could not be validated.");
    }
    return document;
  }

  private void validateBlockRequirements(JsonNode blocks) {
    int index = 0;
    for (JsonNode block : blocks) {
      index++;
      if (!block.isObject()) {
        throw new IllegalArgumentException("Notification block " + index + " must be an object.");
      }
      String type = block.path("type").asText("");
      if (!BLOCK_TYPES.contains(type)) {
        throw new IllegalArgumentException("Unsupported notification block type: " + type);
      }
      if ("cta".equals(type)) {
        String label = block.path("label").asText("").trim();
        String target = block.path("target").asText("").trim();
        if (label.isEmpty() || label.length() > 80 || target.isEmpty()) {
          throw new IllegalArgumentException("CTA blocks need a short label and a safe destination.");
        }
        validateTarget(target);
      }
      if ("image".equals(type) || "animation".equals(type)) {
        boolean decorative = block.path("decorative").asBoolean(false);
        if (!decorative && block.path("alt").asText("").trim().isEmpty()) {
          throw new IllegalArgumentException("Meaningful images need alternative text.");
        }
      }
    }
  }

  private void validateTree(JsonNode node, int depth, int[] nodeCount) {
    if (depth > MAX_DEPTH) {
      throw new IllegalArgumentException("Notification content is nested too deeply.");
    }
    nodeCount[0]++;
    if (nodeCount[0] > MAX_NODES) {
      throw new IllegalArgumentException("Notification content has too many nested elements.");
    }

    if (node.isObject()) {
      Iterator<String> names = node.fieldNames();
      while (names.hasNext()) {
        String name = names.next();
        nodeCount[0]++;
        if (nodeCount[0] > MAX_NODES) {
          throw new IllegalArgumentException("Notification content has too many nested elements.");
        }
        if (UNSAFE_KEYS.contains(name.toLowerCase(Locale.ROOT))) {
          throw new IllegalArgumentException("Executable HTML and script properties are not allowed.");
        }

        JsonNode value = node.get(name);
        if ("type".equals(name) && value.isTextual() && !BLOCK_TYPES.contains(value.asText())) {
          throw new IllegalArgumentException("Unsupported notification block type: " + value.asText());
        }

        if (value.isTextual()) {
          String text = value.asText();
          if (text.length() > MAX_TEXT_LENGTH) {
            throw new IllegalArgumentException("A notification text field exceeds 5000 characters.");
          }
          String lower = text.trim().toLowerCase(Locale.ROOT);
          if (lower.startsWith("javascript:") || lower.startsWith("data:text/html:")
              || lower.startsWith("vbscript:")) {
            throw new IllegalArgumentException("Unsafe URL or executable content is not allowed.");
          }
          if ("url".equalsIgnoreCase(name) || "href".equalsIgnoreCase(name)
              || "target".equalsIgnoreCase(name)) {
            validateTarget(text);
          }
        } else {
          validateTree(value, depth + 1, nodeCount);
        }
      }
    } else if (node.isArray()) {
      for (JsonNode child : node) {
        validateTree(child, depth + 1, nodeCount);
      }
    }
  }

  private static void validateTarget(String rawTarget) {
    String target = rawTarget == null ? "" : rawTarget.trim();
    if (target.startsWith("/") && !target.startsWith("//") && !target.contains("\\")
        && !target.contains("\r") && !target.contains("\n")) {
      return;
    }
    try {
      URI uri = URI.create(target);
      if ("https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null
          && uri.getUserInfo() == null) {
        return;
      }
    } catch (IllegalArgumentException ignored) {
      // Malformed and disallowed destinations share one validation response.
    }
    throw new IllegalArgumentException("Links must be internal application routes or HTTPS URLs.");
  }
}
