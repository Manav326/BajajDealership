package com.quantaedge.bajaj.social;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.quantaedge.bajaj.security.StaffPrincipal;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@Service
public class SocialMediaAssetService {
 private static final long MAX_BYTES=4_500_000,URL_TTL=1800;
 private static final String SIGN_CONTEXT="bajaj-social-media-asset-v1";
 private final JdbcTemplate jdbc; private final ObjectMapper mapper; private final SocialMediaObjectStorage storage;
 private final String publicBaseUrl,signingKeyBase64;
 public SocialMediaAssetService(JdbcTemplate jdbc,ObjectMapper mapper,SocialMediaObjectStorage storage,
  @Value("${app.social.media.public-base-url:}") String publicBaseUrl,
  @Value("${app.social.media.asset-signing-key-base64:}") String signingKeyBase64){
  this.jdbc=jdbc;this.mapper=mapper;this.storage=storage;
  this.publicBaseUrl=trimSlash(publicBaseUrl==null?"":publicBaseUrl.trim());this.signingKeyBase64=signingKeyBase64==null?"":signingKeyBase64.trim();
 }
 public boolean isConfigured(){
  if(!isSafeOrigin(publicBaseUrl)||!storage.isConfigured())return false;
  try{return Base64.getDecoder().decode(signingKeyBase64).length==32;}catch(IllegalArgumentException e){return false;}
 }
 public UploadedAsset upload(StaffPrincipal actor,MultipartFile file){
  requireConfigured();if(file==null||file.isEmpty())throw badRequest("Choose campaign artwork to publish.");
  if(file.getSize()>MAX_BYTES)throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,"Artwork must be 4.5 MB or smaller.");
  final byte[] bytes;try{bytes=file.getBytes();}catch(IOException e){throw badRequest("Artwork could not be read.");}
  if(!"image/jpeg".equals(imageType(bytes)))throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE,"Upload JPEG artwork for social publishing.");
  int width,height;
  try(ImageInputStream input=ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))){
   if(input==null)throw badRequest("JPEG artwork could not be decoded.");var readers=ImageIO.getImageReaders(input);
   if(!readers.hasNext())throw badRequest("JPEG artwork could not be decoded.");ImageReader reader=readers.next();
   try{
    reader.setInput(input,true,true);width=reader.getWidth(0);height=reader.getHeight(0);
    if(width<1||height<1||width>6000||height>6000||(long)width*height>16_000_000L)throw badRequest("Artwork exceeds 6000-pixel / 16-megapixel limit.");
    BufferedImage decoded=reader.read(0);if(decoded==null)throw badRequest("JPEG artwork could not be decoded.");
   }finally{reader.dispose();}
  }catch(IOException e){throw badRequest("JPEG artwork could not be decoded.");}
  UUID id=UUID.randomUUID();String storageKey=storage.newKey(id+".jpg");storage.write(storageKey,bytes,"image/jpeg");
  try{
   jdbc.update("insert into social_media_asset(public_id,dealership_id,created_by_staff_user_id,mime_type,byte_length,sha256,width,height,storage_key,status) values(?,?,?,'image/jpeg',?,?,?,?,?,'ACTIVE')",
    id,actor.dealershipId(),actor.staffUserId(),bytes.length,sha256(bytes),width,height,storageKey);
   audit(actor,"SOCIAL_ASSET_UPLOADED",Map.of("assetPublicId",id.toString(),"byteLength",bytes.length,"width",width,"height",height));
  }catch(RuntimeException e){storage.delete(storageKey);throw e;}
  return new UploadedAsset(id,"image/jpeg",bytes.length,width,height,Instant.now());
 }
 public PreparedAsset prepare(long dealershipId,UUID assetPublicId){
  requireConfigured();
  List<StoredAsset> rows=jdbc.query("select id,public_id,mime_type,storage_key,status from social_media_asset where dealership_id=? and public_id=?",
   (rs,n)->new StoredAsset(rs.getLong("id"),rs.getObject("public_id",UUID.class),rs.getString("mime_type"),rs.getString("storage_key"),rs.getString("status"),-1L,""),
   dealershipId,assetPublicId);
  if(rows.isEmpty()||!"ACTIVE".equals(rows.getFirst().status())||!"image/jpeg".equals(rows.getFirst().mimeType()))throw notFound();
  StoredAsset asset=rows.getFirst();long exp=Instant.now().plusSeconds(URL_TTL).getEpochSecond();
  return new PreparedAsset(asset.id(),asset.publicId(),asset.mimeType(),publicBaseUrl+"/api/v1/social/media/"+asset.publicId()+"?expires="+exp+"&signature="+sign(asset.publicId(),exp));
 }
 public PublicAsset read(UUID assetId,long expires,String signature){
  if(!isConfigured()||signature==null||signature.length()>128)throw notFound();long now=Instant.now().getEpochSecond();
  if(expires<=now||expires>now+URL_TTL+60)throw notFound();String expected=sign(assetId,expires);
  if(!MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),signature.getBytes(StandardCharsets.UTF_8)))throw notFound();
  List<StoredAsset> rows=jdbc.query("select id,public_id,mime_type,storage_key,status,byte_length,sha256 from social_media_asset where public_id=? and status='ACTIVE'",
   (rs,n)->new StoredAsset(rs.getLong("id"),rs.getObject("public_id",UUID.class),rs.getString("mime_type"),rs.getString("storage_key"),rs.getString("status"),rs.getLong("byte_length"),rs.getString("sha256")),assetId);
  if(rows.isEmpty())throw notFound();StoredAsset asset=rows.getFirst();
  byte[] bytes=storage.read(asset.storageKey());
  if(bytes.length!=asset.byteLength()||!sha256(bytes).equals(asset.sha256())||!"image/jpeg".equals(imageType(bytes)))throw notFound();
  return new PublicAsset(bytes,"image/jpeg");
 }
 private void requireConfigured(){if(!isConfigured())throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Publishing needs a public HTTPS media URL and 32-byte asset-signing key.");}
 private String sign(UUID id,long exp){
  try{Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(Base64.getDecoder().decode(signingKeyBase64),"HmacSHA256"));return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal((SIGN_CONTEXT+"\n"+id+"\n"+exp).getBytes(StandardCharsets.UTF_8)));}
  catch(Exception e){throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Artwork signing is unavailable.");}
 }
 private void audit(StaffPrincipal actor,String action,Map<String,Object> details){
  try{jdbc.update("insert into social_media_audit(dealership_id,actor_staff_user_id,provider,action,details) values(?,?,'META',?,?::jsonb)",actor.dealershipId(),actor.staffUserId(),action,mapper.writeValueAsString(details));}
  catch(JsonProcessingException e){throw new IllegalStateException("Artwork audit details could not be serialized.");}
 }
 private static boolean isSafeOrigin(String raw){
  try{URI u=URI.create(raw);boolean secure="https".equalsIgnoreCase(u.getScheme())||("http".equalsIgnoreCase(u.getScheme())&&("localhost".equalsIgnoreCase(u.getHost())||"127.0.0.1".equalsIgnoreCase(u.getHost())));
   return secure&&u.isAbsolute()&&u.getHost()!=null&&(u.getPath()==null||u.getPath().isBlank()||"/".equals(u.getPath()))&&u.getQuery()==null&&u.getFragment()==null;
  }catch(IllegalArgumentException e){return false;}
 }
 private static String trimSlash(String s){while(s.endsWith("/"))s=s.substring(0,s.length()-1);return s;}
 private static String imageType(byte[] b){return b.length>=3&&(b[0]&255)==255&&(b[1]&255)==216&&(b[2]&255)==255?"image/jpeg":"application/octet-stream";}
 private static String sha256(byte[] b){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(b));}catch(NoSuchAlgorithmException e){throw new IllegalStateException("SHA-256 required.",e);}}
 private static ResponseStatusException badRequest(String m){return new ResponseStatusException(HttpStatus.BAD_REQUEST,m);}
 private static ResponseStatusException notFound(){return new ResponseStatusException(HttpStatus.NOT_FOUND,"Artwork is unavailable.");}
 public record UploadedAsset(UUID assetId,String mimeType,long byteLength,int width,int height,Instant createdAt){}
 public record PreparedAsset(long internalId,UUID assetId,String mimeType,String publicUrl){}
 public record PublicAsset(byte[] bytes,String mimeType){}
 private record StoredAsset(long id,UUID publicId,String mimeType,String storageKey,String status,long byteLength,String sha256){}
}
