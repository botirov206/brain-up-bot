export const texts = {
  adminWelcome:
    "👋 Brain-Up admin menu is ready.\n\n" +
    "📅 Today's progress shows check-ins and topic replies. 🌅 Check-ins shows names and wake times.\n" +
    "⏰ Schedule Settings shows times and group setup. 🧠 Topics lets you add prompts.\n\n" +
    "👥 First setup: add the bot as a group admin, then send /group inside the group.",
  adminAlready: "🛠 Your admin menu is below. Tap a button to review the day, topics, schedule, or feedback.",
  welcome:
    "👋 Salom! Men Brain-Up botiman.\n\n" +
    "🌅 Har tong guruhdagi bugungi «Uyg'ondim» tugmasi orqali uyg'onganingizni belgilang. Tugma 12:00 gacha ishlaydi.\n" +
    "🎙 Kunlik mavzu shu yerga keladi. Javobni ovozli xabar yoki dumaloq video qilib yuboring.",
  alreadyRegistered: "✅ Siz botga ulangansiz. Uyg'onganingizni belgilash uchun guruhdagi bugungi tugmani 12:00 gacha bosing.",
  startInGroup: "🌅 Uyg'onishni belgilash uchun guruhdagi bugungi tugmani bosing. Bot bilan suhbat shaxsiy chatda davom etadi.",
  wakeOk: (time: string) => `✅ Bugungi uyg'onishingiz ${time} da qayd etildi. Ajoyib boshlanish!`,
  wakeAlready: (time: string) => `✅ Bugun allaqachon ${time} da uyg'ongan deb belgilangan ekansiz.`,
  wakeExpired: "⏰ Bu uyg'onish tugmasi eskirgan yoki bugungi 12:00 muddati tugagan. Hali ertalab bo'lsa, guruhdagi bugungi yangi tugmani bosing; aks holda ertaga urinib ko'ring.",
  morningHello: "🌅 Xayrli tong, Brain-Up jamoasi!\n\nHar yangi tong — yangi imkoniyat. Bugun ham maqsadingiz sari bir qadam tashlang! 💪\nUyg'ongan bo'lsangiz, pastdagi «Uyg'ondim» tugmasini bosing.\n\n⏰ Belgilash 12:00 gacha. Eski tugmalar ishlamaydi; bugungi tugmadan foydalaning.",
  wakeButton: "🌅 Uyg'ondim",
  wakeCount: (wakes: number, total: number) => `🌅 Bugun uyg'onganlar: ${wakes}/${total}`,
  topicDm: (date: string, topic: string) =>
    `🧠 Bugungi mavzu (${date}):\n\n${topic}\n\n🎙 Javobingizni ovozli xabar yoki dumaloq video qilib shu chatga yuboring.`,
  replyThanks: "✅ Rahmat! Javobingiz guruhga yuborildi.",
  replyAlready: "✅ Bugungi javobingiz allaqachon qabul qilingan. Ertangi mavzuni kuting.",
  replyNoTopic: "🕒 Bugungi mavzu hali yuborilmadi. Keyinroq tekshiring.",
  replyNeedStart: "👋 Avval shu shaxsiy chatda /start buyrug'ini yuboring.",
  replyWrongKind: "🎙 Javobni ovozli xabar yoki dumaloq video qilib yuboring. Matn va rasm mavzu javobi sifatida qabul qilinmaydi.",
  replyGroupFailed: "⚠️ Javobni guruhga yubora olmadim. Iltimos, birozdan keyin qayta urinib ko'ring.",
  groupReplyCaption: (name: string) => `🎙 ${name} — bugungi mavzuga javob`,
  report: (date: string, wakes: number, replies: number, total: number, topicSent: number) =>
    `📊 Brain-Up hisoboti — ${date}\n🌅 Uyg'onganlar: ${total ? `${wakes}/${total}` : "botni boshlaganlar yo'q"}\n🎙 Mavzuga javoblar: ${topicSent ? `${replies}/${topicSent}` : "mavzu hali yuborilmadi"}\nℹ️ Uyg'onish hisobi botni boshlaganlar bo'yicha; javoblar hisobi bugungi mavzuni olganlar bo'yicha.`,
  genericError: "⚠️ Xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring.",
  feedbackAsk: "💬 Botni qanday yaxshilash mumkin? Taklifingizni bitta xabarda yozing.",
  feedbackThanks: "✅ Rahmat! Taklifingiz adminga yetib bordi.",
  feedbackTooLong: "✂️ Xabar juda uzun. Iltimos, 2000 belgigacha qisqartiring.",
  feedbackHint: "💬 Fikr va takliflar uchun «Taklif» tugmasini bosing.",
  feedbackGroupUsage: "💬 Taklif yuborish: /feedback matningiz\nYoki botning shaxsiy chatida «Taklif» tugmasini bosing.",
  explainAsk:
    "📝 Bugun uyg'onishni belgilamadingiz yoki kech belgiladingiz.\n" +
    "Sababini bitta xabarda yozing. Masalan, tugmani unutdingizmi yoki kech uyg'ondingizmi?",
  explainNotNeeded: "✅ Bugun o'z vaqtida belgilangansiz. Sabab yozishingiz shart emas.",
  explainAlready: "✅ Sababingiz allaqachon qabul qilingan.",
  explainThanks: "✅ Rahmat! Sababingiz admin uchun saqlandi.",
  explainTooLong: "✂️ Sabab juda uzun. Iltimos, 2000 belgigacha qisqartiring.",
  explainButton: "📝 Sababni yozish",
  explainGroup: (onTime: string) =>
    `📝 «Uyg'ondim»ni ${onTime} gacha bosmaganlar: iltimos, kechikish sababini yozing.\n` +
    "Tugmani unutdingizmi yoki kech uyg'ondingizmi? Pastdagi tugmani bosing yoki shu xabarga javob yozing.\n" +
    "✅ O'z vaqtida belgilanganlarga sabab yozish shart emas.",
};

export const MAX_TOPIC_LENGTH = 3500;

export function clipText(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}
