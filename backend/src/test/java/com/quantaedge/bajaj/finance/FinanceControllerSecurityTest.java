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
class FinanceControllerSecurityTest {
  @Autowired private MockMvc mvc;

  @Test
  void financeReadsRequireAuthenticatedStaff() throws Exception {
    mvc.perform(get("/api/v1/admin/finance/summary")).andExpect(status().isUnauthorized());
    mvc.perform(get("/api/v1/admin/finance/expenses")).andExpect(status().isUnauthorized());
  }

  @Test
  void financeReadDoesNotGrantExpenseCreation() throws Exception {
    mvc.perform(post("/api/v1/admin/finance/expenses")
            .with(user("finance-reader").authorities(new SimpleGrantedAuthority("finance.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "idempotencyKey":"security-test-expense",
                  "expenseDate":"2026-10-28",
                  "category":"Supplies",
                  "description":"Authorization boundary test",
                  "vendorName":null,
                  "paymentMethod":"CASH",
                  "paymentReference":null,
                  "amount":10.00
                }
                """))
        .andExpect(status().isForbidden());
  }

  @Test
  void expensePermissionDoesNotGrantApproval() throws Exception {
    mvc.perform(post("/api/v1/admin/finance/expenses/{publicId}/approve", UUID.randomUUID())
            .with(user("expense-creator").authorities(new SimpleGrantedAuthority("finance.expense"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void approvalPermissionDoesNotGrantExpenseReversal() throws Exception {
    mvc.perform(post("/api/v1/admin/finance/expenses/{publicId}/reverse", UUID.randomUUID())
            .with(user("expense-approver").authorities(new SimpleGrantedAuthority("finance.approve")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"reason\":\"Authorization boundary test\",\"externalReference\":null}"))
        .andExpect(status().isForbidden());
  }
}
