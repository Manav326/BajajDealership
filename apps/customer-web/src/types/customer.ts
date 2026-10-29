export type CustomerProfile = {
  publicId: string;
  customerCode: string;
  fullName: string;
  phone: string | null;
  alternatePhone: string | null;
  email: string | null;
  preferredLanguage: 'hi' | 'en' | 'hinglish';
  profilePhotoAvailable: boolean;
  dealershipCode: string;
  dealershipName: string;
};
