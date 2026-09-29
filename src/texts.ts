export const texts = {
  welcome:
    "Salom! Men Brain-Up botiman.\n\n" +
    "Har kuni ertalab uyg'onishni belgilaysiz va shu yerga mavzu keladi. " +
    "Javobni dumaloq video yoki ovozli xabar qilib yuboring.\n\n" +
    "Guruhdagi «Uyg'ondim» tugmasini bosing.",
  alreadyRegistered: "Siz ro'yxatdasiz. Guruhdagi «Uyg'ondim» tugmasi shu chatni ochadi.",
  startInGroup: "Uyg'onish uchun menga shaxsiy yozing yoki guruhdagi «Uyg'ondim» tugmasini bosing.",
  wakeOk: (time: string) => `Qabul qilindi. Bugun soat ${time} da uyg'ondingiz.`,
  wakeAlready: (time: string) => `Bugun allaqachon uyg'ongan deb belgilandingiz (${time}).`,
  morningHello: "Xayrli tong!\n\nUyg'ongan bo'lsangiz, «Uyg'ondim» tugmasini bosing.",
  wakeButton: "Uyg'ondim",
  wakeCount: (wakes: number, total: number) => `${wakes} / ${total} uyg'ondi`,
  topicDm: (date: string, topic: string) =>
    `Bugungi mavzu (${date}):\n\n${topic}\n\nJavobni dumaloq video yoki ovozli xabar qilib yuboring.`,
  replyThanks: "Rahmat! Javobingiz guruhga yuborildi.",
  replyAlready: "Bugungi javobingiz allaqachon qabul qilingan.",
  replyNoTopic: "Bugungi mavzu hali yuborilmagan.",
  replyNeedStart: "Avval shu chatda /start bosing.",
  replyWrongKind: "Javobni dumaloq video yoki ovozli xabar qilib yuboring. Matn yoki rasm emas.",
  replyGroupFailed: "Guruhga yuborib bo'lmadi. Birozdan qayta yuboring.",
  groupReplyCaption: (name: string) => `${name} — bugungi mavzu`,
  report: (date: string, wakes: number, replies: number, total: number) =>
    `Brain-Up hisobot — ${date}\nUyg'onganlar: ${wakes}/${total}\nMavzu javoblari: ${replies}/${total}`,
  genericError: "Xatolik yuz berdi. Keyinroq urinib ko'ring.",
};

export const MAX_TOPIC_LENGTH = 3500;
