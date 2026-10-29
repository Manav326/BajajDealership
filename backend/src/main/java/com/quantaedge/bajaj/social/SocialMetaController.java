package com.quantaedge.bajaj.social;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Meta account authorization endpoints. Provider tokens are never returned to the client. */
@RestController
public class SocialMetaController {
  private final SocialMetaService meta;
  private final SocialMetaPublishingService publishing;
  public SocialMetaController(SocialMetaService meta,SocialMetaPublishingService publishing){this.meta=meta;this.publishing=publishing;}

  @GetMapping("/api/v1/admin/social/meta/status")
  @PreAuthorize("hasAuthority('social_media.read')")
  public SocialMetaService.StatusView status(@AuthenticationPrincipal StaffPrincipal principal) {
    return meta.status(principal);
  }

  @PostMapping("/api/v1/admin/social/meta/disconnect")
  @PreAuthorize("hasAuthority('social_media.manage')")
  public SocialMetaService.DisconnectResult disconnect(@AuthenticationPrincipal StaffPrincipal principal) {
    return meta.disconnect(principal);
  }

  @PostMapping("/api/v1/admin/social/meta/connect")
  @PreAuthorize("hasAuthority('social_media.manage')")
  public SocialMetaService.ConnectResponse connect(@AuthenticationPrincipal StaffPrincipal principal) {
    return meta.beginAuthorization(principal);
  }

  @PostMapping("/api/v1/admin/social/meta/publish")
  @PreAuthorize("hasAuthority('social_media.publish')")
  public SocialMetaPublishingService.PublishView publish(@AuthenticationPrincipal StaffPrincipal principal,@Valid @RequestBody SocialMetaPublishingService.PublishRequest request){return publishing.publish(principal,request);}
  @GetMapping("/api/v1/admin/social/meta/publishes/{publicId}")
  @PreAuthorize("hasAuthority('social_media.read')")
  public SocialMetaPublishingService.PublishView publishStatus(@AuthenticationPrincipal StaffPrincipal principal,@PathVariable UUID publicId){return publishing.status(principal,publicId);}

  /** Meta redirects here with a one-time state. The frontend callback URL is server-configured. */
  @GetMapping("/api/v1/social/meta/callback")
  public ResponseEntity<Void> callback(
      @RequestParam(required = false) String code,
      @RequestParam(required = false) String state,
      @RequestParam(required = false, name = "error") String providerError) {
    URI destination = meta.completeAuthorization(state, code, providerError);
    return ResponseEntity.status(HttpStatus.SEE_OTHER).location(destination).build();
  }
}
