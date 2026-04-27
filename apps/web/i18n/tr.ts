const tr = {
  common: {
    close: "Kapat",
    cancel: "Vazgec",
    apply: "Uygula",
    search: "Ara",
    save: "Kaydet",
    loading: "Yukleniyor..."
  },
  shell: {
    nav: {
      dashboard: "Panel",
      templates: "Sablonlar",
      lists: "Listeler",
      segments: "Segmentler",
      send: "Gonderim",
      campaigns: "Kampanyalar",
      smtp: "SMTP",
      suppression: "Baskilama",
      logs: "Loglar"
    },
    language: "Dil",
    logout: "Cikis"
  },
  empty: {
    backendRequired: "Bu islem icin backend endpoint gerekli"
  },
  send: {
    bootstrapFailedTitle: "Gonderim kurulum verisi yuklenemedi.",
    bootstrapFailedBody: "Lutfen sayfayi yenileyip tekrar deneyin.",
    templateRequiredTitle: "Sablon secilmedi",
    templateRequiredBody: "Kampanya baslatmadan once bir sablon secin.",
    targetRequiredTitle: "Hedef secilmedi",
    targetRequiredBody: "Liste, segment veya ad-hoc kosul secin.",
    targetZeroTitle: "Hedef sayisi sifir",
    targetZeroBody: "Secili hedefte kullanilabilir alici bulunamadi.",
    smtpRequiredTitle: "Kullanilabilir SMTP havuzu yok",
    smtpRequiredBody: "En az bir aktif ve saglikli SMTP hesabi gerekli."
  },
  smtp: {
    deleteFailed: "SMTP silinemedi.",
    operationFailed: "Islem basarisiz.",
    saveFailed: "SMTP kaydedilemedi.",
    connectionTestFailed: "SMTP baglanti testi basarisiz.",
    connectionTestSuccess: "SMTP baglanti testi basarili."
  },
  templates: {
    listLoadFailed: "Sablon kutuphanesi yuklenemedi.",
    createFailed: "Sablon olusturulamadi.",
    saveFailed: "Sablon kaydedilemedi.",
    deleteFailed: "Sablon silinemedi.",
    detailFailed: "Sablon detayi alinamadi."
  },
  lists: {
    summaryLoadFailed: "Liste ozeti alinamadi.",
    createFailed: "Liste olusturulamadi.",
    updateFailed: "Liste guncellenemedi.",
    deleteFailed: "Liste silinemedi.",
    importFailed: "Toplu ice aktarma basarisiz.",
    removeFailed: "Toplu kaldirma basarisiz.",
    searchFailed: "Arama basarisiz."
  }
} as const;

export default tr;
