package com.quantaedge.bajaj.finance;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.time.LocalDate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/finance/reports")
public class OperationalReportsController {
  private final OperationalReportsService reports;

  public OperationalReportsController(OperationalReportsService reports) {
    this.reports = reports;
  }

  @GetMapping("/operations")
  @PreAuthorize("hasAuthority('report.read')")
  public OperationalReportsService.OperationalReport operations(
      @AuthenticationPrincipal StaffPrincipal actor,
      @RequestParam LocalDate fromDate,
      @RequestParam LocalDate toDate) {
    return reports.report(actor, fromDate, toDate);
  }
}
