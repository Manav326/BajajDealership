package com.quantaedge.bajaj.notifications;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/notifications")
public class NotificationController {
  private final NotificationManagementService notifications;

  public NotificationController(NotificationManagementService notifications) {
    this.notifications = notifications;
  }

  @GetMapping("/options")
  @PreAuthorize("hasAuthority('notification.read')")
  public NotificationManagementService.NotificationOptions options(
      @AuthenticationPrincipal StaffPrincipal principal) {
    return notifications.options(principal);
  }

  @GetMapping("/templates")
  @PreAuthorize("hasAuthority('notification.read')")
  public TemplateList templates(@AuthenticationPrincipal StaffPrincipal principal) {
    return new TemplateList(notifications.listTemplates(principal));
  }

  @PostMapping("/templates")
  @PreAuthorize("hasAuthority('notification.create')")
  public NotificationManagementService.TemplateView createTemplate(
      @AuthenticationPrincipal StaffPrincipal principal,
      @Valid @RequestBody TemplateRequest request) {
    return notifications.createTemplate(principal, request.toServiceRequest());
  }

  @PutMapping("/templates/{publicId}")
  @PreAuthorize("hasAuthority('notification.create')")
  public NotificationManagementService.TemplateView updateTemplate(
      @AuthenticationPrincipal StaffPrincipal principal,
      @PathVariable UUID publicId,
      @Valid @RequestBody TemplateRequest request) {
    return notifications.createTemplateVersion(principal, publicId, request.toServiceRequest());
  }

  @GetMapping("/recipients")
  @PreAuthorize("hasAuthority('notification.create')")
  public RecipientList recipients(
      @AuthenticationPrincipal StaffPrincipal principal,
      @RequestParam String kind,
      @RequestParam(required = false) @Size(max = 100) String query) {
    return new RecipientList(notifications.searchRecipients(principal, kind, query));
  }

  @PostMapping("/preview")
  @PreAuthorize("hasAuthority('notification.create')")
  public NotificationManagementService.PreviewResult preview(
      @AuthenticationPrincipal StaffPrincipal principal,
      @Valid @RequestBody PreviewRequest request) {
    return notifications.preview(principal, request.toServiceRequest());
  }

  @PostMapping("/send")
  @PreAuthorize("hasAuthority('notification.send')")
  public NotificationManagementService.CampaignResult send(
      @AuthenticationPrincipal StaffPrincipal principal,
      @Valid @RequestBody SendRequest request) {
    return notifications.send(principal, request.toServiceRequest());
  }

  @GetMapping("/campaigns")
  @PreAuthorize("hasAuthority('notification.read')")
  public CampaignList campaigns(
      @AuthenticationPrincipal StaffPrincipal principal,
      @RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit) {
    return new CampaignList(notifications.listCampaigns(principal, limit));
  }

  @PostMapping("/campaigns/{publicId}/cancel")
  @PreAuthorize("hasAuthority('notification.approve')")
  public NotificationManagementService.CampaignView cancel(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID publicId) {
    return notifications.cancel(principal, publicId);
  }

  @GetMapping("/inbox")
  @PreAuthorize("hasAuthority('notification.read')")
  public NotificationManagementService.Page<NotificationManagementService.InboxItem> inbox(
      @AuthenticationPrincipal StaffPrincipal principal,
      @RequestParam(defaultValue = "0") @Min(0) int page,
      @RequestParam(defaultValue = "25") @Min(1) @Max(100) int pageSize,
      @RequestParam(defaultValue = "false") boolean unreadOnly) {
    return notifications.inbox(principal, page, pageSize, unreadOnly);
  }

  @PostMapping("/inbox/{recipientPublicId}/read")
  @PreAuthorize("hasAuthority('notification.read')")
  public void markRead(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID recipientPublicId) {
    notifications.markRead(principal, recipientPublicId, true);
  }

  @PostMapping("/inbox/{recipientPublicId}/unread")
  @PreAuthorize("hasAuthority('notification.read')")
  public void markUnread(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID recipientPublicId) {
    notifications.markRead(principal, recipientPublicId, false);
  }

  @PostMapping("/inbox/{recipientPublicId}/dismiss")
  @PreAuthorize("hasAuthority('notification.read')")
  public void dismiss(
      @AuthenticationPrincipal StaffPrincipal principal, @PathVariable UUID recipientPublicId) {
    notifications.dismiss(principal, recipientPublicId);
  }

  @PostMapping("/inbox/read-all")
  @PreAuthorize("hasAuthority('notification.read')")
  public MarkReadResult markAllRead(@AuthenticationPrincipal StaffPrincipal principal) {
    return new MarkReadResult(notifications.markAllRead(principal));
  }

  public record TemplateRequest(
      @NotBlank @Size(max = 120) String templateName,
      @Size(max = 500) String description,
      @NotNull Object contentDocument) {
    NotificationManagementService.TemplateRequest toServiceRequest() {
      return new NotificationManagementService.TemplateRequest(templateName, description, contentDocument);
    }
  }

  public record PreviewRequest(
      @NotBlank @Size(max = 30) String scope,
      @NotBlank @Size(max = 120) String title,
      @NotBlank @Size(max = 300) String summary,
      @NotNull Object audienceFilter,
      @NotNull Object contentDocument,
      UUID templatePublicId,
      Integer templateVersion) {
    NotificationManagementService.PreviewRequest toServiceRequest() {
      return new NotificationManagementService.PreviewRequest(
          scope, title, summary, audienceFilter, contentDocument, templatePublicId, templateVersion);
    }
  }

  public record SendRequest(
      @NotNull UUID campaignPublicId,
      @NotBlank @Size(max = 200) String previewToken,
      @NotBlank @Size(max = 120) String idempotencyKey,
      Instant scheduledAt,
      Instant expiresAt) {
    NotificationManagementService.SendRequest toServiceRequest() {
      return new NotificationManagementService.SendRequest(
          campaignPublicId, previewToken, idempotencyKey, scheduledAt, expiresAt);
    }
  }

  public record TemplateList(List<NotificationManagementService.TemplateView> templates) {}
  public record RecipientList(List<NotificationManagementService.RecipientOption> recipients) {}
  public record CampaignList(List<NotificationManagementService.CampaignView> campaigns) {}
  public record MarkReadResult(int updatedCount) {}
}
