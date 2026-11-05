package com.quantaedge.bajaj.downloads;

import java.io.InputStream;
import java.util.Optional;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

/** Public, same-origin release status and byte-stream endpoints for the app download cards. */
@RestController
@RequestMapping("/api/v1/public/downloads")
public class PublicDownloadController {
  private final PublicDownloadService downloads;

  public PublicDownloadController(PublicDownloadService downloads) {
    this.downloads = downloads;
  }

  @GetMapping("/status")
  public PublicDownloadService.DownloadStatus status() throws Exception {
    return downloads.getStatus();
  }

  @GetMapping("/{platform}")
  public ResponseEntity<StreamingResponseBody> download(
      @PathVariable String platform,
      @RequestHeader(value = HttpHeaders.RANGE, required = false) String range,
      @RequestHeader(value = "If-Range", required = false) String ifRange) throws Exception {
    Optional<PublicDownloadService.DownloadAsset> result = downloads.openDownload(platform, range, ifRange);
    if (result.isEmpty()) return ResponseEntity.notFound().cacheControl(CacheControl.noStore()).build();

    PublicDownloadService.DownloadAsset asset = result.get();
    var upstream = asset.response();
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.APPLICATION_OCTET_STREAM);
    headers.setContentDisposition(ContentDisposition.attachment().filename(asset.fileName()).build());
    headers.setCacheControl(CacheControl.noStore().cachePrivate());
    headers.set("X-Content-Type-Options", "nosniff");
    upstream.headers().firstValue("Accept-Ranges").ifPresent(value -> headers.set("Accept-Ranges", value));
    upstream.headers().firstValue("Content-Length").ifPresent(value -> headers.set(HttpHeaders.CONTENT_LENGTH, value));
    upstream.headers().firstValue("Content-Range").ifPresent(value -> headers.set(HttpHeaders.CONTENT_RANGE, value));
    upstream.headers().firstValue("Last-Modified").ifPresent(value -> headers.set(HttpHeaders.LAST_MODIFIED, value));
    upstream.headers().firstValue("ETag").ifPresent(value -> headers.setETag(value));

    if (upstream.statusCode() == 416) {
      try (InputStream ignored = upstream.body()) {
        return ResponseEntity.status(416).headers(headers).build();
      }
    }

    StreamingResponseBody body = output -> {
      try (InputStream input = upstream.body()) {
        byte[] buffer = new byte[128 * 1024];
        int read;
        while ((read = input.read(buffer)) != -1) {
          output.write(buffer, 0, read);
        }
        output.flush();
      }
    };
    return ResponseEntity.status(upstream.statusCode()).headers(headers).body(body);
  }
}
