# Araxá Moto

MVP instalável para corridas de mototáxi e entregas. Inclui perfis de cliente, mototaxista e administrador; mapa OpenStreetMap; rota, distância e preço automáticos; carteira; diária de R$ 6; comissão de 8%; e painel operacional.

## Executar

É necessário Node.js 20 ou mais recente.

```bash
npm start
```

Abra `http://localhost:3000`. Os três botões iniciais entram em perfis demonstrativos. Para testar o fluxo completo, abra o cliente e o mototaxista em navegadores ou perfis diferentes.

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
