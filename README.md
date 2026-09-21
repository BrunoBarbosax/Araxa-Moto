# Araxá Moto V6 Premium

Versão de produção baseada na V5, preservando PostgreSQL e recursos existentes.

## V6
- interface premium preto e dourado
- mapa com mototaxistas online
- rastreamento do motorista aceito
- canal em tempo real via Server-Sent Events (sem polling para eventos principais)
- atualização ao vivo da posição do motorista durante corrida
- ETA e distância aproximada do motorista até o embarque
- despacho de novas solicitações apenas para motoristas online dentro do raio máximo configurado
- ordenação de motoristas por proximidade
- rota e preço via OpenStreetMap/Nominatim + OSRM
- notificações locais/web quando permitidas
- validação de coordenadas GPS
- PostgreSQL em produção e fallback local em desenvolvimento
- painel administrativo, aprovação de motoristas, taxas, avaliações, planos e suporte preservados

## Produção
Variáveis: DATABASE_URL, NODE_ENV=production, ADMIN_USERNAME e ADMIN_PASSWORD.

### Observações mobile
O código web envia GPS continuamente enquanto a WebView está ativa. Rastreamento garantido com app minimizado/tela bloqueada exige serviço nativo de localização em segundo plano e permissões específicas do Android/iOS. Push remoto com app totalmente fechado exige credenciais de um provedor (por exemplo FCM/APNs). Esses segredos não podem ser pré-configurados no pacote sem as contas do projeto.

## Testes
Execute `npm test`.

## Deploy
Docker/Render: mantenha o mesmo DATABASE_URL para preservar os dados.

# Araxá Moto V5 — Premium

Redesign completo preto e dourado, preservando backend, PostgreSQL, rastreamento em tempo real e recursos da V4.

# Araxá Moto — versão piloto quase final

Aplicativo de operação de mototáxi, entregas e serviços, com perfis de passageiro, mototaxista e administração.

## Entregue nesta versão

- cálculo pela rota real do mapa e detalhamento antes da confirmação;
- tarifas urbana, rural, rodoviária, intermunicipal, serviços/documentos, piloto à disposição e entrega;
- corrida imediata ou agendada, paradas, ida e volta e solicitação para outra pessoa;
- despacho, aceite, chegada, código de embarque, execução, conclusão, cancelamento e avaliação;
- passageiro com planos, histórico, notificações, contato de emergência e chamados;
- freelancer com diária de R$ 6,00 e repasse de 92%;
- contratado com salário mensal, jornada e hora extra sujeita à aprovação;
- cadastro documental e aprovação administrativa;
- contratos individuais e empresariais, controle de créditos e vencimento;
- painel administrativo com corridas, cadastros, finanças, horas extras, incidentes e auditoria;
- estrutura Android e iOS via Capacitor.

## Pendências externas e burocráticas

- CNPJ, termos, política de privacidade, contratos e validação jurídica municipal;
- conta bancária/Pix empresarial e credenciais do intermediador de pagamento;
- provedores de SMS, WhatsApp e notificações push;
- chaves próprias e limites comerciais de geocodificação/mapas;
- banco PostgreSQL gerenciado, backup e observabilidade de produção;
- contas Google Play e Apple Developer, certificados e publicação;
- homologação operacional, seguros e validação dos documentos reais.

## Regimes de trabalho

- Freelancer: paga R$ 6,00 por dia para operar, recebe 92% do valor das corridas e o aplicativo registra 8% de comissão.
- Contratado: recebe salário mensal fixo definido pelo administrador, sem diária e sem comissão individual por corrida.
- O candidato informa uma preferência no cadastro, mas somente o administrador confirma o regime na aprovação.
- Contratados podem iniciar e encerrar um registro de hora extra. O administrador define o valor por hora e aprova ou rejeita cada registro antes de ele entrar no total aprovado.

MVP instalável para corridas de mototáxi e entregas. Inclui cadastro de passageiros, cadastro e análise documental de mototaxistas, mapa OpenStreetMap, rota, distância e preço automáticos, carteira, diária de R$ 6, comissão de 8% e painel operacional.

> Segurança: a hospedagem demonstrativa ainda usa armazenamento local temporário. Não cadastre CNH ou documentos reais até a migração para banco e armazenamento privado permanentes.

## Executar

É necessário Node.js 20 ou mais recente.

```bash
npm start
```

Abra `http://localhost:3000`. Os três botões iniciais entram em perfis demonstrativos. Para testar o fluxo completo, abra o cliente e o mototaxista em navegadores ou perfis diferentes.

## Render com Docker

O `Dockerfile` da raiz inicia o servidor Node.js e utiliza automaticamente a variável `PORT` fornecida pelo Render. No serviço Render configurado como Docker, mantenha o campo Dockerfile como `./Dockerfile`.

No Render, abra **Environment** e crie as variáveis secretas `ADMIN_USERNAME` e `ADMIN_PASSWORD`. Não coloque a senha administrativa no GitHub ou no código-fonte.

## Testes

```bash
npm test
```

## Android e iPhone

O projeto inclui configuração Capacitor para gerar aplicativos nativos e já aponta para `https://araxa-moto.onrender.com`.

```bash
npm install
npx cap add android
npx cap add ios
npx cap sync
```

O Android gera APK/AAB pelo Android Studio. O iPhone não usa APK: gera IPA e exige macOS, Xcode e assinatura de uma conta Apple Developer.

### APK automático pelo GitHub

O fluxo `.github/workflows/build-android.yml` compila um APK de teste automaticamente. No GitHub, abra **Actions → Build Android APK → Run workflow**. Quando terminar, baixe o arquivo **araxa-moto-debug-apk** na área **Artifacts** da execução.

## Produção

Esta entrega é um MVP funcional. O mapa usa OpenStreetMap, Nominatim e OSRM sem chave para demonstração. Antes da operação comercial com volume, contrate ou hospede serviços compatíveis com as políticas dessas plataformas. Também substitua o acesso demonstrativo por autenticação via SMS, configure Pix/cartão, notificações push, HTTPS, banco PostgreSQL, backups e análise jurídica/regulatória municipal. Não use dados reais no modo de demonstração.

## Versão 2

- Interface mapa-primeiro com novo design responsivo.
- Cadastro com telefone e senha.
- Cadastro de mototaxista com idade mínima, CNH A/AB, validade, motocicleta, Pix e três documentos.
- Estado de análise, aprovação e rejeição com justificativa.
- Painel administrativo para visualizar documentos e liberar condutores.
- Condutor bloqueado de ficar online até a aprovação.


## V4 — mapa em tempo real
- Mototaxistas online aparecem no mapa do passageiro quando há posição GPS recente.
- Após o aceite, o passageiro acompanha o mototaxista no mapa com atualização a cada ~4 segundos.
- O motorista online envia GPS enquanto o app está aberto e autorizado.
- A API não expõe localização de motoristas offline ou com posição antiga.
- Nova identidade visual, logo e tela de acompanhamento.

> Para rastreamento com o aplicativo minimizado no Android/iOS, será necessária a etapa nativa de localização em segundo plano e as permissões das lojas.


## V6.1 — uploads de documentos
- Limite por documento ampliado para 10 MB (CNH, documento da moto e foto de perfil).
- Limite do corpo da requisição ampliado para comportar os três documentos em Base64.
- Validação mantida no navegador e no servidor.


## V6.3
- Visualização de CNH, CRLV e foto de perfil diretamente no painel administrativo, com miniaturas e tela ampliada.
- Fluxo de verificação/solicitação de GPS para passageiro e mototaxista.
- Permissões ACCESS_COARSE_LOCATION e ACCESS_FINE_LOCATION adicionadas ao Android.
- Mensagens específicas para GPS desligado e permissão negada.


## V6.3 — diária freelancer com prazo de 24 horas
- Freelancer pode iniciar a primeira diária mesmo sem saldo.
- A diária de R$ 6 fica pendente por até 24 horas.
- Durante o prazo, o motorista continua trabalhando normalmente.
- Não acumula várias diárias fiadas: existe no máximo uma pendência.
- Após 24 horas sem quitação, uma nova diária fica bloqueada até o pagamento.
- Ao adicionar saldo suficiente, a pendência é quitada automaticamente.
- Contratados não são afetados por essa regra.
