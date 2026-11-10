import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Política de Privacidade" };

export default function PrivacidadePage() {
  return (
    <LegalPage titulo="Política de Privacidade" atualizado="10 de novembro de 2026">
      <section>
        <h2>1. Quem somos</h2>
        <p>
          O Lito CRM é o sistema interno de relacionamento com clientes da Lito Aviation Academy
          (https://litoaviation.com), usado exclusivamente pela nossa equipe. Esta política explica
          quais dados o sistema trata e como.
        </p>
      </section>
      <section>
        <h2>2. Dados que tratamos</h2>
        <ul>
          <li>Dados de contatos e leads: nome, telefone, e-mail, documento e histórico de atendimento.</li>
          <li>Mensagens trocadas com a escola pelo WhatsApp e por e-mail.</li>
          <li>
            Dados de pagamento recebidos da nossa plataforma de vendas (status e valores; não
            armazenamos dados de cartão).
          </li>
          <li>Dados de uso da equipe interna (login e registro de ações).</li>
        </ul>
      </section>
      <section>
        <h2>3. Dados do Google (Google Ads)</h2>
        <p>
          Quando um administrador conecta uma conta do Google Ads, o Lito CRM solicita acesso de{" "}
          <strong>somente leitura</strong> (escopo https://www.googleapis.com/auth/adwords) para
          exibir, nos relatórios internos, métricas de desempenho das nossas próprias campanhas:
          cliques, conversões, custo e lista de campanhas.
        </p>
        <ul>
          <li>Não criamos, alteramos nem excluímos campanhas ou anúncios.</li>
          <li>
            Os dados do Google não são vendidos, não são compartilhados com terceiros e não são
            usados para publicidade.
          </li>
          <li>O token de acesso fica armazenado de forma restrita no servidor, nunca no navegador.</li>
          <li>
            O uso de dados recebidos das APIs do Google segue a{" "}
            <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy">
              Política de Dados do Usuário dos Serviços de API do Google
            </a>
            , incluindo os requisitos de Uso Limitado.
          </li>
          <li>
            A conexão pode ser removida a qualquer momento em Relatórios → Google Ads → Desconectar,
            ou em{" "}
            <a className="underline" href="https://myaccount.google.com/permissions">
              myaccount.google.com/permissions
            </a>
            .
          </li>
        </ul>
      </section>
      <section>
        <h2>4. Para que usamos os dados</h2>
        <p>
          Para atender alunos e interessados, acompanhar matrículas e pagamentos e medir o resultado
          das nossas campanhas de marketing, com base na Lei Geral de Proteção de Dados (Lei
          13.709/2018): execução de contrato, legítimo interesse e consentimento.
        </p>
      </section>
      <section>
        <h2>5. Compartilhamento</h2>
        <p>
          Os dados ficam em provedores contratados para operar o sistema (hospedagem e banco de
          dados, envio de e-mail, WhatsApp Business da Meta e IA para resumo e transcrição de
          atendimentos), que tratam os dados apenas em nosso nome.
        </p>
      </section>
      <section>
        <h2>6. Retenção e segurança</h2>
        <p>
          Guardamos os dados enquanto houver relacionamento com o titular ou obrigação legal. O
          acesso é restrito por login e pelas permissões de cada membro da equipe.
        </p>
      </section>
      <section>
        <h2>7. Seus direitos</h2>
        <p>
          Você pode pedir acesso, correção, exclusão ou portabilidade dos seus dados, e se descadastrar
          dos e-mails de marketing pelo link em cada mensagem. Fale conosco em contato@litoaviation.com.
        </p>
      </section>
    </LegalPage>
  );
}
