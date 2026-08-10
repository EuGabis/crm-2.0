/**
 * Modelos prontos de campanha. `html` é só o CORPO (o shell da marca é
 * adicionado no envio por renderCampaignEmail). Variáveis via {{nome}} etc.
 */
export interface CampaignTemplate {
  id: string;
  name: string;
  description: string;
  subject: string;
  html: string;
}

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    id: "boas-vindas",
    name: "Boas-vindas",
    description: "Receba novos contatos com um tom caloroso.",
    subject: "Bem-vindo(a), {{nome}}! 👋",
    html: `<h2>Que bom ter você aqui, {{nome}}!</h2>
<p>Obrigado por se juntar à nossa comunidade. A partir de agora você vai receber conteúdos e novidades feitos pra ajudar o seu negócio a crescer.</p>
<p>Se precisar de qualquer coisa, é só responder este e-mail.</p>
<p>Um abraço,<br />Equipe</p>`,
  },
  {
    id: "newsletter",
    name: "Newsletter",
    description: "Atualização periódica com destaques do mês.",
    subject: "As novidades deste mês ✨",
    html: `<h2>O que rolou por aqui</h2>
<p>Olá, {{nome}}! Separamos os destaques deste mês pra você:</p>
<ul>
  <li>Novidade número um</li>
  <li>Novidade número dois</li>
  <li>Uma dica prática pra aplicar hoje</li>
</ul>
<p>Boa leitura!</p>`,
  },
  {
    id: "oferta",
    name: "Oferta",
    description: "Promoção com chamada para ação e senso de urgência.",
    subject: "Oferta especial pra você, {{nome}} 🎁",
    html: `<h2>Uma condição especial esperando por você</h2>
<p>{{nome}}, preparamos uma oferta exclusiva por tempo limitado.</p>
<p><a href="https://">Garantir minha oferta →</a></p>
<p>Corre, porque acaba em breve!</p>`,
  },
  {
    id: "reengajamento",
    name: "Reengajamento",
    description: "Reconquiste contatos que sumiram.",
    subject: "Sentimos sua falta, {{nome}}",
    html: `<h2>Faz um tempo que a gente não se fala…</h2>
<p>{{nome}}, queremos saber como você está. Voltamos com novidades que talvez te interessem.</p>
<p><a href="https://">Ver o que preparamos →</a></p>
<p>Se não quiser mais receber, é só usar o link de descadastro no rodapé — sem ressentimentos. 💜</p>`,
  },
];
