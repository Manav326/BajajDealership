package com.quantaedge.bajaj.inventory;

import com.quantaedge.bajaj.security.StaffPrincipal;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
public class BajajMotorcycleImageController {
  private final BajajMotorcycleImageService images;
  public BajajMotorcycleImageController(BajajMotorcycleImageService images) { this.images=images; }

  @GetMapping("/api/v1/admin/catalogue/models/{modelCode}/images")
  @PreAuthorize("hasAuthority('catalogue.read')")
  public ImageList list(@AuthenticationPrincipal StaffPrincipal actor,@PathVariable @Size(max=60) String modelCode) {
    return new ImageList(images.list(actor,modelCode));
  }

  @PostMapping(value="/api/v1/admin/catalogue/models/{modelCode}/images",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
  @PreAuthorize("hasAuthority('catalogue.manage')")
  public BajajMotorcycleImageService.UploadedImage upload(@AuthenticationPrincipal StaffPrincipal actor,
      @PathVariable @Size(max=60) String modelCode,@RequestPart("file") MultipartFile file) {
    return images.upload(actor,modelCode,file);
  }

  @DeleteMapping("/api/v1/admin/catalogue/models/{modelCode}/images/{imageId}")
  @PreAuthorize("hasAuthority('catalogue.manage')")
  public OperationResult delete(@AuthenticationPrincipal StaffPrincipal actor,
      @PathVariable @Size(max=60) String modelCode,@PathVariable UUID imageId) {
    images.delete(actor,modelCode,imageId);
    return new OperationResult(true,"Image removed.");
  }

  @GetMapping("/api/v1/public/catalogue/bikes/images/{modelCode}/{imageId}")
  public ResponseEntity<byte[]> read(@PathVariable @Size(max=60) String modelCode,
      @PathVariable UUID imageId,@RequestParam(required=false) @Size(max=40) String dealershipCode) {
    BajajMotorcycleImageService.PublicImage image=images.readPublic(dealershipCode,modelCode,imageId);
    return ResponseEntity.ok().contentType(MediaType.parseMediaType(image.contentType()))
      .contentLength(image.bytes().length)
      .cacheControl(CacheControl.maxAge(java.time.Duration.ofHours(1)).cachePublic())
      .header("X-Content-Type-Options","nosniff")
      .header(HttpHeaders.CONTENT_DISPOSITION,"inline")
      .body(image.bytes());
  }

  public record ImageList(List<BajajMotorcycleImageService.UploadedImage> items) {}
  public record OperationResult(boolean success,String message) {}
}
