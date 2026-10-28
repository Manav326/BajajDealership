package com.quantaedge.bajaj.finance;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class FinanceAdjustmentsControllerSecurityTest {
  @Autowired private MockMvc mvc;

  @Test
  void adjustmentReadsRequireAuthenticatedStaff() throws Exception {
    mvc.perform(get("/api/v1/admin/finance/adjustments")).andExpect(status().isUnauthorized());
    mvc.perform(get("/api/v1/admin/finance/adjustments/invoices")).andExpect(status().isUnauthorized());
    mvc.perform(get("/api/v1/admin/finance/reports/operations")
        .param("fromDate", "2026-10-01").param("toDate", "2026-10-28"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void financeReadDoesNotGrantAdjustmentCreationOrReview() throws Exception {
    mvc.perform(post("/api/v1/admin/finance/adjustments")
        .with(user("finance-reader").authorities(new SimpleGrantedAuthority("finance.read")))
        .contentType(MediaType.APPLICATION_JSON)
        .content("""
            {
              "adjustmentType":"CREDIT_NOTE","sourceType":"SALES",
              "invoicePublicId":"11111111-1111-4111-8111-111111111111",
              "amount":100.00,"reason":"Security boundary test","idempotencyKey":"adjust-test-create"
            }
            """))
        .andExpect(status().isForbidden());

    mvc.perform(post("/api/v1/admin/finance/adjustments/{id}/approve", UUID.randomUUID())
        .with(user("finance-reader").authorities(new SimpleGrantedAuthority("finance.read"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void paymentPermissionDoesNotGrantAdjustmentApproval() throws Exception {
    mvc.perform(post("/api/v1/admin/finance/adjustments/{id}/approve", UUID.randomUUID())
        .with(user("payment-operator").authorities(new SimpleGrantedAuthority("finance.payment"))))
        .andExpect(status().isForbidden());
    mvc.perform(post("/api/v1/admin/finance/adjustments/{id}/reject", UUID.randomUUID())
        .with(user("payment-operator").authorities(new SimpleGrantedAuthority("finance.payment")))
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"reason\":\"Security boundary test\"}"))
        .andExpect(status().isForbidden());
  }

  @Test
  void adjustmentApprovalDoesNotGrantPayoutAttestation() throws Exception {
    mvc.perform(post("/api/v1/admin/finance/adjustments/{id}/mark-paid", UUID.randomUUID())
        .with(user("adjustment-reviewer").authorities(new SimpleGrantedAuthority("finance.adjustment.approve")))
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"paymentMethod\":\"CASH\",\"paymentReference\":null}"))
        .andExpect(status().isForbidden());
  }

  @Test
  void financeReadDoesNotGrantRefundPayoutAttestation() throws Exception {
    mvc.perform(post("/api/v1/admin/finance/adjustments/{id}/mark-paid", UUID.randomUUID())
        .with(user("finance-reader").authorities(new SimpleGrantedAuthority("finance.read")))
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"paymentMethod\":\"CASH\",\"paymentReference\":null}"))
        .andExpect(status().isForbidden());
  }
}
