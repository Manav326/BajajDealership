package com.quantaedge.bajaj.inventory;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@Service
public class BajajMotorcycleImageService {
  private static final int MAX_BYTES = 4_718_592;
  private final JdbcTemplate jdbc;
  public BajajMotorcycleImageService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

  @Transactional
  public UploadedImage upload(StaffPrincipal actor, String rawModelCode, MultipartFile file) {
    String code = normalize(rawModelCode); requireModel(actor.dealershipId(), code);
    if (file == null || file.isEmpty()) throw bad("Choose a JPEG, PNG or WebP image.");
    if (file.getSize() > MAX_BYTES) throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Images must be 4.5 MiB or smaller.");
    byte[] bytes;
    try { bytes = file.getBytes(); } catch (IOException ex) { throw bad("The image could not be read."); }
    String type = detect(bytes);
    if (type == null) throw bad("Only valid JPEG, PNG and WebP images are accepted.");
    String declared = file.getContentType();
    if (declared != null && !declared.isBlank() && !declared.equalsIgnoreCase(type)) throw bad("The file content does not match its image type.");
    String filename = file.getOriginalFilename() == null ? "motorcycle-image" : file.getOriginalFilename().replace('\\','/');
    filename = filename.substring(filename.lastIndexOf('/') + 1).replaceAll("[^A-Za-z0-9._-]", "_");
    if (filename.isBlank()) filename = "motorcycle-image";
    if (filename.length() > 180) filename = filename.substring(0, 180);
    String digest = digest(bytes);
    jdbc.update("update bajaj_motorcycle_image set is_primary=false where dealership_id=? and model_code=? and is_primary=true", actor.dealershipId(), code);
    Integer next = jdbc.queryForObject("select coalesce(max(sort_order),0)+1 from bajaj_motorcycle_image where dealership_id=? and model_code=?", Integer.class, actor.dealershipId(), code);
    UUID id = jdbc.queryForObject("""
      insert into bajaj_motorcycle_image(dealership_id,model_code,original_filename,content_type,image_bytes,sha256,size_bytes,sort_order,is_primary,uploaded_by_staff_user_id)
      values (?,?,?,?,?,?,?,?,true,?) returning public_id
      """, UUID.class, actor.dealershipId(), code, filename, type, bytes, digest, bytes.length, next == null ? 100 : next, actor.staffUserId());
    return new UploadedImage(id, code, type, bytes.length, true, java.time.Instant.now());
  }

  public List<UploadedImage> list(StaffPrincipal actor, String rawCode) {
    String code = normalize(rawCode); requireModel(code);
    return jdbc.query("""
      select public_id,model_code,content_type,size_bytes,is_primary,created_at
      from bajaj_motorcycle_image where dealership_id=? and model_code=?
      order by is_primary desc,sort_order,id desc
      """, (rs,n) -> new UploadedImage(rs.getObject("public_id",UUID.class),rs.getString("model_code"),
      rs.getString("content_type"),rs.getInt("size_bytes"),rs.getBoolean("is_primary"),rs.getTimestamp("created_at").toInstant()),
      actor.dealershipId(),code);
  }

  @Transactional
  public void delete(StaffPrincipal actor, String rawCode, UUID imageId) {
    String code = normalize(rawCode); requireModel(code);
    List<Map<String,Object>> rows = jdbc.queryForList("select id,is_primary from bajaj_motorcycle_image where dealership_id=? and model_code=? and public_id=? for update",actor.dealershipId(),code,imageId);
    if (rows.isEmpty()) throw notFound("Uploaded image was not found for this model.");
    long id=((Number)rows.getFirst().get("id")).longValue();
    boolean primary=Boolean.TRUE.equals(rows.getFirst().get("is_primary"));
    jdbc.update("delete from bajaj_motorcycle_image where dealership_id=? and id=?",actor.dealershipId(),id);
    if(primary) jdbc.update("""
      update bajaj_motorcycle_image set is_primary=true where id=(
        select id from bajaj_motorcycle_image where dealership_id=? and model_code=? order by sort_order,id desc limit 1
      ) and dealership_id=?
      """,actor.dealershipId(),code,actor.dealershipId());
  }

  public PublicImage readPublic(String rawDealerCode,String rawModelCode,UUID imageId) {
    String code=normalize(rawModelCode);
    String dealerCode=rawDealerCode==null?"":rawDealerCode.trim().toUpperCase(Locale.ROOT);
    List<Long> ids;
    if(!dealerCode.isBlank()) ids=jdbc.query("select id from dealership where code=? and status='ACTIVE'",(rs,n)->rs.getLong(1),dealerCode);
    else ids=jdbc.query("select id from dealership where status='ACTIVE' order by id",(rs,n)->rs.getLong(1));
    if(ids.isEmpty()) throw notFound("The selected dealership is unavailable.");
    if(ids.size()>1) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"A dealershipCode is required.");
    List<PublicImage> found=jdbc.query("""
      select content_type,image_bytes,size_bytes,sha256 from bajaj_motorcycle_image
      where dealership_id=? and model_code=? and public_id=?
      """,(rs,n)->new PublicImage(rs.getString("content_type"),rs.getBytes("image_bytes"),rs.getInt("size_bytes"),rs.getString("sha256")),ids.getFirst(),code,imageId);
    if(found.isEmpty()) throw notFound("Image was not found.");
    PublicImage image=found.getFirst();
    if(image.bytes()==null || image.bytes().length!=image.sizeBytes() || !digest(image.bytes()).equalsIgnoreCase(image.sha256())
      || !List.of("image/jpeg","image/png","image/webp").contains(image.contentType()) || !image.contentType().equals(detect(image.bytes()))) throw notFound("The uploaded image is unavailable.");
    return image;
  }

  private void requireModel(long dealershipId, String code) {
    Integer count = jdbc.queryForObject("""
      select count(*) from bajaj_catalogue_model c
      join bajaj_catalogue_dealership_model settings on settings.model_code = c.model_code
      where c.model_code = ? and c.manufacturer = 'BAJAJ' and c.active = true
        and settings.dealership_id = ?
      """, Integer.class, code, dealershipId);
    if (count == null || count != 1) throw notFound("Bajaj catalogue model was not found for this dealership.");
  }
  private static String normalize(String raw) {
    if(raw==null||!raw.trim().matches("(?i)[a-z0-9][a-z0-9._-]{0,59}")) throw bad("A valid model code is required.");
    return raw.trim().toUpperCase(Locale.ROOT);
  }
  private static String detect(byte[] b) {
    if(b==null||b.length<12) return null;
    if((b[0]&255)==255&&(b[1]&255)==216&&(b[2]&255)==255) return "image/jpeg";
    if((b[0]&255)==137&&b[1]==80&&b[2]==78&&b[3]==71&&b[4]==13&&b[5]==10&&b[6]==26&&b[7]==10) return "image/png";
    if(b[0]==82&&b[1]==73&&b[2]==70&&b[3]==70&&b[8]==87&&b[9]==69&&b[10]==66&&b[11]==80) return "image/webp";
    return null;
  }
  private static String digest(byte[] b) {
    try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(b)); }
    catch(NoSuchAlgorithmException e) { throw new IllegalStateException("SHA-256 is unavailable.",e); }
  }
  private static ResponseStatusException bad(String s){return new ResponseStatusException(HttpStatus.BAD_REQUEST,s);}
  private static ResponseStatusException notFound(String s){return new ResponseStatusException(HttpStatus.NOT_FOUND,s);}
  public record UploadedImage(UUID publicId,String modelCode,String contentType,int sizeBytes,boolean primary,java.time.Instant uploadedAt){}
  public record PublicImage(String contentType,byte[] bytes,int sizeBytes,String sha256){}
}
