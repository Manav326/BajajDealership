package com.quantaedge.bajaj.social;
import com.quantaedge.bajaj.security.StaffPrincipal;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
@RestController public class SocialMediaAssetController{
 private final SocialMediaAssetService assets;
 public SocialMediaAssetController(SocialMediaAssetService assets){this.assets=assets;}
 @PostMapping(path="/api/v1/admin/social/media",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
 @PreAuthorize("hasAuthority('social_media.publish')")
 public SocialMediaAssetService.UploadedAsset upload(@AuthenticationPrincipal StaffPrincipal principal,@RequestPart("file") MultipartFile file){return assets.upload(principal,file);}
 @GetMapping("/api/v1/admin/social/media/{assetPublicId}/preview")
 @PreAuthorize("hasAuthority('social_media.read')")
 public ResponseEntity<byte[]> privatePreview(@AuthenticationPrincipal StaffPrincipal principal,@PathVariable UUID assetPublicId){
  var asset=assets.readForDealership(principal.dealershipId(),assetPublicId);
  return ResponseEntity.ok().contentType(MediaType.parseMediaType(asset.mimeType()))
   .contentLength(asset.bytes().length).cacheControl(CacheControl.noStore())
   .header(HttpHeaders.CONTENT_DISPOSITION,"inline; filename=\"campaign-preview.jpg\"")
   .header("X-Content-Type-Options","nosniff").body(asset.bytes());
 }
 /** HMAC and expiry authorize provider reads without making the asset permanently public. */
 @GetMapping("/api/v1/social/media/{assetPublicId}")
 public ResponseEntity<byte[]> publicMedia(@PathVariable UUID assetPublicId,@RequestParam long expires,@RequestParam String signature){
  var asset=assets.read(assetPublicId,expires,signature);return ResponseEntity.ok().contentType(MediaType.parseMediaType(asset.mimeType()))
   .contentLength(asset.bytes().length).cacheControl(CacheControl.noStore()).header(HttpHeaders.CONTENT_DISPOSITION,"inline; filename=\"campaign.jpg\"")
   .header("X-Content-Type-Options","nosniff").body(asset.bytes());
 }
}
