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
  void financeReadDoesNotGrantDailyClosing() throws Exception {
    mvc.perform(post("/api/v1/admin/finance/daily-close")
            .with(user("finance-reader").authorities(new SimpleGrantedAuthority("finance.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "businessDate":"2026-10-28",
                  "openingBalances":{"cash":0,"upi":0,"bankTransfer":0,"card":0,"other":0},
                  "countedClosing":{"cash":0,"upi":0,"bankTransfer":0,"card":0,"other":0},
                  "notes":null
                }
                """))
        .andExpect(status().isForbidden());
  }

  @Test
  void financeReadDoesNotGrantReportsPermission() throws Exception {
    mvc.perform(get("/api/v1/admin/finance/reports/daily")
            .param("fromDate","2026-10-01").param("toDate","2026-10-28")
            .with(user("finance-reader").authorities(new SimpleGrantedAuthority("finance.read"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void closeAndReportReadsRequireAuthentication() throws Exception {
    mvc.perform(get("/api/v1/admin/finance/daily-close/preview").param("businessDate","2026-10-28"))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/v1/admin/finance/reports/daily").param("fromDate","2026-10-01").param("toDate","2026-10-28"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void financeReadDoesNotGrantTaxProfileChanges() throws Exception {
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/api/v1/admin/finance/tax-profile")
            .with(user("finance-reader").authorities(new SimpleGrantedAuthority("finance.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"registrationType\":\"UNREGISTERED\",\"eInvoiceApplicability\":\"NOT_ASSESSED\"}"))
        .andExpect(status().isForbidden());
  }

  @Test
  void financeReadDoesNotGrantTaxCodeCreationOrVerification() throws Exception {
    mvc.perform(post("/api/v1/admin/finance/tax-codes")
            .with(user("finance-reader").authorities(new SimpleGrantedAuthority("finance.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "code":"TAX-CODE-TEST",
                  "description":"Security boundary only",
                  "hsnSacCode":"1234",
                  "supplyType":"GOODS",
                  "gstRate":0,
                  "cessRate":0,
                  "effectiveFrom":"2026-10-28",
                  "effectiveTo":null,
                  "sourceReference":null
                }
                """))
        .andExpect(status().isForbidden());
    mvc.perform(post("/api/v1/admin/finance/tax-codes/{publicId}/verify", UUID.randomUUID())
            .with(user("finance-reader").authorities(new SimpleGrantedAuthority("finance.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"sourceReference\":\"test\",\"verificationNote\":\"test only\"}"))
        .andExpect(status().isForbidden());
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
