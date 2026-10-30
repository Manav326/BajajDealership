package com.quantaedge.bajaj.system;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.quantaedge.bajaj.security.StaffPrincipal;
import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementCreator;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owner-only export of dealership business records.
 *
 * The table allowlist is based on business-domain prefixes and direct dealership ownership.
 * Authentication/session/licensing/social configuration tables are intentionally excluded;
 * credential-like columns and nested payload/configuration fields are omitted as defense in depth.
 */
@Service
public class DealershipDataExportService {
  private static final List<String> BUSINESS_PREFIXES = List.of(
      "customer", "sales_", "vehicle_", "service_", "spare_part", "part_",
      "finance_", "staff_user", "bajaj_", "workshop_", "invoice_", "payment_");
  private static final Pattern EXCLUDED_TABLE = Pattern.compile(
      ".*(auth|session|token|secret|credential|oauth|webhook|password|login|invitation|reset|identity|provider|licen[cs]e|social|notification|media|asset|gateway|configuration|config|portal|tracking|audit).*",
      Pattern.CASE_INSENSITIVE);
  private static final Pattern EXCLUDED_COLUMN = Pattern.compile(
      ".*(password|token|secret|credential|hash|api.?key|private.?key|salt|session|oauth|webhook|signature|jwt|authorization|payload|details|metadata|config|key_material|sensitive).*",
      Pattern.CASE_INSENSITIVE);

  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;

  public DealershipDataExportService(JdbcTemplate jdbc, ObjectMapper mapper) {
    this.jdbc = jdbc;
    this.mapper = mapper;
  }

  public void recordExportRequested(StaffPrincipal actor, UUID exportId) {
    jdbc.update("""
        insert into audit_event(
          dealership_id, actor_kind, action, entity_type, entity_id, reason, details)
        values (?, 'SYSTEM', 'DEALERSHIP_DATA_EXPORT_REQUESTED',
          'DEALERSHIP_DATA_EXPORT', ?, 'Dealership owner requested a business data export',
          jsonb_build_object('staffPublicId', ?, 'exportId', ?, 'format', 'zip-jsonl'))
        """,
        actor.dealershipId(), exportId.toString(), actor.staffPublicId(), exportId.toString());
  }

  @Transactional(readOnly = true)
  public Map<String, Long> writeExport(StaffPrincipal actor, UUID exportId, OutputStream output) throws IOException {
    Map<String, Long> counts = new LinkedHashMap<>();
    try (ZipOutputStream zip = new ZipOutputStream(output, StandardCharsets.UTF_8)) {
      writeEntry(zip, "README.txt", """
          Lucky Bajaj dealership data export

          Format: ZIP archive containing newline-delimited JSON (.jsonl) records.
          Each non-empty line in a .jsonl file is one JSON object.
          manifest.json records the export time and row count for each file.

          This export includes dealership-owned business records available to the current
          schema. Authentication sessions, invitation/reset tokens, licensing/device
          credentials, integration secrets, binary uploads and audit-event payloads are
          intentionally not exported. Credential-like columns, nested payloads, metadata
          and configuration columns are removed as an additional safety measure.
          """);

      for (String table : discoverExportTables()) {
        long count = writeTable(zip, table, actor.dealershipId());
        counts.put(table, count);
      }

      Map<String, Object> manifest = new LinkedHashMap<>();
      manifest.put("format", "lucky-bajaj-owner-export-zip-jsonl-v1");
      manifest.put("exportId", exportId.toString());
      manifest.put("createdAt", Instant.now().toString());
      manifest.put("dealershipCode", actor.dealershipCode());
      manifest.put("exportedByStaffPublicId", actor.staffPublicId());
      manifest.put("recordsByTable", counts);
      manifest.put("totalRecords", counts.values().stream().mapToLong(Long::longValue).sum());
      manifest.put("excludedDataPolicy",
          "Authentication/session/license/social credentials, secret-like columns, JSON payload/metadata/configuration fields and audit-event payloads are omitted.");
      writeEntry(zip, "manifest.json", mapper.writeValueAsString(manifest));
    } catch (UncheckedIOException exception) {
      throw exception.getCause();
    }
    return counts;
  }

  public void recordExportCompleted(StaffPrincipal actor, UUID exportId, Map<String, Long> counts) {
    long total = counts.values().stream().mapToLong(Long::longValue).sum();
    jdbc.update("""
        insert into audit_event(
          dealership_id, actor_kind, action, entity_type, entity_id, reason, details)
        values (?, 'SYSTEM', 'DEALERSHIP_DATA_EXPORT_COMPLETED',
          'DEALERSHIP_DATA_EXPORT', ?, 'Dealership business data export streamed',
          jsonb_build_object('staffPublicId', ?, 'exportId', ?, 'tableCount', ?, 'recordCount', ?))
        """,
        actor.dealershipId(), exportId.toString(), actor.staffPublicId(),
        exportId.toString(), counts.size(), total);
  }

  private List<String> discoverExportTables() {
    List<String> tables = jdbc.query("""
        select table_name
        from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name
        """, (rs, rowNum) -> rs.getString(1));

    List<String> result = new ArrayList<>();
    for (String table : tables) {
      if (!table.matches("[a-z][a-z0-9_]*") || EXCLUDED_TABLE.matcher(table).matches()) continue;
      boolean selected = table.equals("dealership")
          || BUSINESS_PREFIXES.stream().anyMatch(table::startsWith);
      if (!selected) continue;
      if (table.equals("dealership") || hasColumn(table, "dealership_id")) {
        result.add(table);
      }
    }
    return result;
  }

  private boolean hasColumn(String table, String column) {
    Integer count = jdbc.queryForObject("""
        select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = ? and column_name = ?
        """, Integer.class, table, column);
    return count != null && count > 0;
  }

  private long writeTable(ZipOutputStream zip, String table, long dealershipId) throws IOException {
    List<ColumnInfo> columns = jdbc.query("""
        select column_name, data_type
        from information_schema.columns
        where table_schema = 'public' and table_name = ?
        order by ordinal_position
        """, (rs, rowNum) -> new ColumnInfo(rs.getString("column_name"), rs.getString("data_type")), table);
    List<String> excluded = columns.stream()
        .filter(column -> EXCLUDED_COLUMN.matcher(column.name()).matches()
            || "json".equalsIgnoreCase(column.dataType())
            || "jsonb".equalsIgnoreCase(column.dataType())
            || "bytea".equalsIgnoreCase(column.dataType()))
        .map(ColumnInfo::name)
        .toList();

    String excludedSql = excluded.isEmpty()
        ? "ARRAY[]::text[]"
        : "ARRAY[" + excluded.stream().map(DealershipDataExportService::sqlLiteral)
            .reduce((left, right) -> left + ", " + right).orElse("") + "]::text[]";
    String scope = "dealership".equals(table) ? "t.id" : "t.dealership_id";
    String order = columns.stream().anyMatch(column -> "id".equals(column.name())) ? " order by t.id" : "";
    String sql = "select (to_jsonb(t) - " + excludedSql + ")::text as record"
        + " from public.\"" + table + "\" t where " + scope + " = ?" + order;

    zip.putNextEntry(new ZipEntry(table + ".jsonl"));
    try {
      Long count = jdbc.query((PreparedStatementCreator) connection -> {
        PreparedStatement statement = connection.prepareStatement(sql);
        statement.setLong(1, dealershipId);
        statement.setFetchSize(500);
        return statement;
      }, (ResultSetExtractor<Long>) rs -> {
        long rows = 0;
        while (rs.next()) {
          try {
            zip.write(rs.getString("record").getBytes(StandardCharsets.UTF_8));
            zip.write('\n');
          } catch (IOException exception) {
            throw new UncheckedIOException(exception);
          }
          rows++;
        }
        return rows;
      });
      zip.closeEntry();
      return count == null ? 0 : count;
    } catch (UncheckedIOException exception) {
      throw exception.getCause();
    } catch (RuntimeException exception) {
      try {
        zip.closeEntry();
      } catch (IOException ignored) {
        // Keep the database/export error as the primary failure.
      }
      throw exception;
    }
  }

  private static String sqlLiteral(String value) {
    return "'" + value.replace("'", "''") + "'";
  }

  private static void writeEntry(ZipOutputStream zip, String name, String text) throws IOException {
    zip.putNextEntry(new ZipEntry(name));
    zip.write(text.getBytes(StandardCharsets.UTF_8));
    zip.closeEntry();
  }

  private record ColumnInfo(String name, String dataType) {}
}
