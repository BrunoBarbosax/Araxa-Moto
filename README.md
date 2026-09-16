# Araxá Moto

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
