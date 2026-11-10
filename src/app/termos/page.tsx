import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Termos de Serviço" };

export default function TermosPage() {
  return (
    <LegalPage titulo="Termos de Serviço" atualizado="10 de novembro de 2026">
      <section>
        <h2>1. Objeto</h2>
        <p>
          O Lito CRM é uma ferramenta interna da Lito Aviation Academy para gestão de contatos,
          atendimento, funil de vendas e relatórios. O acesso é restrito a membros da equipe
          convidados por um administrador.
        </p>
      </section>
      <section>
        <h2>2. Uso permitido</h2>
        <ul>
          <li>Usar o sistema apenas para as atividades da escola.</li>
          <li>Manter a senha em sigilo e não compartilhar o acesso.</li>
          <li>Tratar os dados de alunos e interessados conforme a Política de Privacidade e a LGPD.</li>
        </ul>
      </section>
      <section>
        <h2>3. Integrações</h2>
        <p>
          Integrações com serviços de terceiros (Google Ads, WhatsApp Business, plataforma de
          pagamentos e e-mail) seguem também os termos desses serviços. A integração com o Google
          Ads é somente leitura e pode ser desconectada a qualquer momento.
        </p>
      </section>
      <section>
        <h2>4. Responsabilidades</h2>
        <p>
          O sistema é fornecido para uso interno. A escola pode suspender acessos, alterar
          funcionalidades e encerrar o serviço a qualquer momento.
        </p>
      </section>
      <section>
        <h2>5. Contato</h2>
        <p>Dúvidas: contato@litoaviation.com.</p>
      </section>
    </LegalPage>
  );
}
