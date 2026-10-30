package com.quantaedge.bajaj.system;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

/** Owner-only, dealership-scoped data export. This GET remains available in license read-only mode. */
@RestController
@RequestMapping("/api/v1/admin/data-export")
public class DealershipDataExportController {
  private static final DateTimeFormatter FILE_STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");
  private final DealershipDataExportService exports;

  public DealershipDataExportController(DealershipDataExportService exports) {
    this.exports = exports;
  }

  @GetMapping
  @PreAuthorize("hasRole('OWNER')")
  public ResponseEntity<StreamingResponseBody> export(
      @AuthenticationPrincipal StaffPrincipal actor) {
    UUID exportId = UUID.randomUUID();
    exports.recordExportRequested(actor, exportId);

    String safeCode = actor.dealershipCode().replaceAll("[^A-Za-z0-9_-]", "_");
    String stamp = LocalDateTime.now(ZoneOffset.UTC).format(FILE_STAMP);
    String filename = "LuckyBajaj-" + safeCode + "-data-export-" + stamp + ".zip";

    StreamingResponseBody body = output -> {
      var counts = exports.writeExport(actor, exportId, output);
      exports.recordExportCompleted(actor, exportId, counts);
    };

    return ResponseEntity.ok()
        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .contentType(MediaType.parseMediaType("application/zip"))
        .body(body);
  }
}
