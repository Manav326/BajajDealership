package com.quantaedge.bajaj.social;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class SocialWhatsappController {
 private final SocialWhatsappService whatsapp;
 private final SocialWhatsappScheduleService schedules;
 public SocialWhatsappController(SocialWhatsappService whatsapp,SocialWhatsappScheduleService schedules){this.whatsapp=whatsapp;this.schedules=schedules;}
 @GetMapping("/api/v1/admin/social/whatsapp/status")
 @PreAuthorize("hasAnyAuthority('social_media.whatsapp.read','social_media.whatsapp.manage','social_media.whatsapp.send')")
 public SocialWhatsappService.StatusView status(@AuthenticationPrincipal StaffPrincipal principal){return whatsapp.status(principal);}
 @GetMapping("/api/v1/admin/social/whatsapp/customers")
 @PreAuthorize("hasAnyAuthority('social_media.whatsapp.read','social_media.whatsapp.manage','social_media.whatsapp.send')")
 public List<SocialWhatsappService.CustomerOption> customers(@AuthenticationPrincipal StaffPrincipal principal,@RequestParam(defaultValue="") String q,@RequestParam(defaultValue="50") int limit){return whatsapp.customers(principal,q,limit);}
 @PostMapping("/api/v1/admin/social/whatsapp/customers/{customerPublicId}/consent")
 @PreAuthorize("hasAuthority('social_media.whatsapp.manage')")
 public SocialWhatsappService.ConsentView consent(@AuthenticationPrincipal StaffPrincipal principal,@PathVariable UUID customerPublicId,@Valid @RequestBody SocialWhatsappService.ConsentRequest request){return whatsapp.recordConsent(principal,customerPublicId,request);}
 @GetMapping("/api/v1/admin/social/whatsapp/templates")
 @PreAuthorize("hasAnyAuthority('social_media.whatsapp.read','social_media.whatsapp.send')")
 public List<SocialWhatsappService.TemplateView> templates(@AuthenticationPrincipal StaffPrincipal principal){return whatsapp.templates(principal);}
 @PostMapping("/api/v1/admin/social/whatsapp/send")
 @PreAuthorize("hasAuthority('social_media.whatsapp.send')")
 public SocialWhatsappService.MessageView send(@AuthenticationPrincipal StaffPrincipal principal,@RequestBody SocialWhatsappService.SendRequest request){return whatsapp.send(principal,request);}
 @PostMapping("/api/v1/admin/social/whatsapp/schedule")
 @PreAuthorize("hasAuthority('social_media.whatsapp.send')")
 public SocialWhatsappScheduleService.ScheduledMessageView schedule(@AuthenticationPrincipal StaffPrincipal principal,@Valid @RequestBody SocialWhatsappScheduleService.ScheduleRequest request){return schedules.schedule(principal,request);}
 @GetMapping("/api/v1/admin/social/whatsapp/scheduled")
 @PreAuthorize("hasAnyAuthority('social_media.whatsapp.read','social_media.whatsapp.manage','social_media.whatsapp.send')")
 public java.util.List<SocialWhatsappScheduleService.ScheduledMessageView> scheduled(@AuthenticationPrincipal StaffPrincipal principal,@RequestParam(defaultValue="50") int limit){return schedules.list(principal,limit);}
 @GetMapping("/api/v1/admin/social/whatsapp/messages/{publicId}")
 @PreAuthorize("hasAnyAuthority('social_media.whatsapp.read','social_media.whatsapp.send')")
 public SocialWhatsappScheduleService.ScheduledMessageView message(@AuthenticationPrincipal StaffPrincipal principal,@PathVariable UUID publicId){return schedules.status(principal,publicId);}
 @GetMapping("/api/v1/social/whatsapp/webhook")
 public ResponseEntity<String> verify(@RequestParam(name="hub.mode",required=false) String mode,@RequestParam(name="hub.verify_token",required=false) String token,@RequestParam(name="hub.challenge",required=false) String challenge){
  if(!whatsapp.verifyWebhook(mode,token,challenge))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"WhatsApp webhook verification failed.");
  return ResponseEntity.ok(challenge);
 }
 @PostMapping("/api/v1/social/whatsapp/webhook")
 public ResponseEntity<Void> webhook(@RequestBody byte[] body,@RequestHeader(name="X-Hub-Signature-256",required=false) String signature){
  if(!whatsapp.verifyWebhookSignature(body,signature))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"WhatsApp webhook signature is invalid.");
  whatsapp.processVerifiedWebhook(body);return ResponseEntity.ok().build();
 }
}
