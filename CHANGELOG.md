# Changelog

All notable changes to Kwami v3 are documented here. This file is generated
from the commit history by semantic-release — do not edit it by hand.

## [3.2.1](https://github.com/kwami-labs/kwami-x/compare/v3.2.0...v3.2.1) (2026-09-17)

### Bug Fixes

- **program:** migrate the vault onto matching Anchor 1.2 crates ([8fd10f0](https://github.com/kwami-labs/kwami-x/commit/8fd10f06906b9abfd581e785d7896b6758441e03))

### Build & Dependencies

- **deps:** bump the minor-and-patch group with 2 updates ([c114a41](https://github.com/kwami-labs/kwami-x/commit/c114a4150fc278174ca763a1e0246e13de764af4))
- **program:** bump anchor-lang from 0.31.1 to 1.2.0 in /programs ([16d7dee](https://github.com/kwami-labs/kwami-x/commit/16d7dee622002cb31833cee04c2326fb6960442c))
- **program:** bump anchor-spl from 0.31.1 to 1.2.0 in /programs ([6840390](https://github.com/kwami-labs/kwami-x/commit/6840390f7301d0ee4c7015f8141ae5e22df6cc34))

## [3.2.0](https://github.com/kwami-labs/kwami-x/compare/v3.1.0...v3.2.0) (2026-09-17)

### Features

- **account:** add a profile page and a real payout wallet ([53262f2](https://github.com/kwami-labs/kwami-x/commit/53262f20422b30ada4f6df4cfde39d106d2d06b1))
- **auth:** redesign the gate with progressive disclosure ([ec44e73](https://github.com/kwami-labs/kwami-x/commit/ec44e737f354337a56ca1441dbf69f9bad9a0103))
- **config:** resolve Supabase from project id and publishable keys ([a14dc74](https://github.com/kwami-labs/kwami-x/commit/a14dc74bc330da071c51d97554d8eede93c94160))
- **db:** add energy balance columns and expose them on kwamis_public ([f2632a9](https://github.com/kwami-labs/kwami-x/commit/f2632a9825bb3fd86f1363807ea271916ee13c02))
- **energy:** add spend/credit helpers and energyPerSol config ([99b3214](https://github.com/kwami-labs/kwami-x/commit/99b3214af4d1a3401cc88a7f2d173f627a701dcb))
- **energy:** bill voice from the session clock ([4a5c6a1](https://github.com/kwami-labs/kwami-x/commit/4a5c6a11e9b36c4badf30946d981052759666c93))
- **energy:** expose Kwami balance, ledger, and top-up endpoints ([80af693](https://github.com/kwami-labs/kwami-x/commit/80af6931bf747bee668d49e1a6e43c615637aa1c))
- **energy:** meter replies and codegen, fuel mints, refuse starved tickets ([cdf7254](https://github.com/kwami-labs/kwami-x/commit/cdf7254189cf092f19980752338175c1439e0728))
- **energy:** model prepaid compute credit and a starving state ([3db2db2](https://github.com/kwami-labs/kwami-x/commit/3db2db2dc3ff8eccdd975eed295bf0af58f56fa6))
- **kwami:** add look presets and random roll helpers ([5591476](https://github.com/kwami-labs/kwami-x/commit/5591476768a72798bd7d0827af3b3c4650171dcf))
- **kwami:** add persona archetypes, trait vectors, and renderer tuning ([d9e431e](https://github.com/kwami-labs/kwami-x/commit/d9e431e69b0c770e3b6440162c63f27531e2f278))
- **kwami:** add skins, a third colour, and per-skin shaders ([8f6330f](https://github.com/kwami-labs/kwami-x/commit/8f6330f0e8f3515c46474cec6f642caf235ef86a))
- **kwami:** share the brain prompt with the voice worker ([b463e52](https://github.com/kwami-labs/kwami-x/commit/b463e5281f2e3ac659c5bc2f497a8d8b9d4bb832))
- **kwami:** store trait vectors on the voice config ([5e2b083](https://github.com/kwami-labs/kwami-x/commit/5e2b0833c4e7af5745cbaf054901e51c9cdcd801))
- **kwami:** surface skins and the third colour on every view ([f1c7609](https://github.com/kwami-labs/kwami-x/commit/f1c760921312d1f26c2569cee9a34a4e272836b7))
- **kwami:** surface starving on the detail page ([a81647f](https://github.com/kwami-labs/kwami-x/commit/a81647fedffff2aced6befb489a129a01ee944ca))
- **mint:** attach opening fuel as a separate treasury transfer ([47ebed0](https://github.com/kwami-labs/kwami-x/commit/47ebed03c8bbf1d218e742d81b97fb8d9d827afc))
- **mint:** rebuild the mint page as a studio ([522f985](https://github.com/kwami-labs/kwami-x/commit/522f985e7305dd38041f69703626998fe98f9193))
- **mint:** rebuild the studio as a scrolling build ([f3ed9e8](https://github.com/kwami-labs/kwami-x/commit/f3ed9e86b2df6af3c86b6c07ec55690100add2fe))
- **play:** challenge over a metered LiveKit room ([a25d522](https://github.com/kwami-labs/kwami-x/commit/a25d522c8a17eb30c19259a2567a796b5fdf19d2))
- **renderer:** apply creator tuning and activity-driven motion in place ([9c66163](https://github.com/kwami-labs/kwami-x/commit/9c661633731035a08a39ee64a34ee760728cc177))
- **studio:** add colour harmonies and form state transitions ([cd68aa4](https://github.com/kwami-labs/kwami-x/commit/cd68aa4e8c0b93577aba2cced69e4121a5766935))
- **studio:** add preview UI pieces and trial energy endpoint ([543e7b4](https://github.com/kwami-labs/kwami-x/commit/543e7b4c226e561306a904a595485be230220db8))
- **studio:** preview a Kwami against trial or Kwami energy ([3e22dd7](https://github.com/kwami-labs/kwami-x/commit/3e22dd7b98423bdd51e88e0464facb670e6084f8))
- **studio:** rehearse over a metered LiveKit room ([fc5cce9](https://github.com/kwami-labs/kwami-x/commit/fc5cce9f1fb144cd27c8be85ca2d4f53b563bdfe))
- **voice:** add the metered LiveKit client and worker callback ([e31c8df](https://github.com/kwami-labs/kwami-x/commit/e31c8df9f75b2245e94b69f704852ac92435223c))
- **voice:** publish agent config and serve runtime where the worker knocks ([3fb87bd](https://github.com/kwami-labs/kwami-x/commit/3fb87bd807db10bf6ba6e8319cb7eb2ea903f237))
- **wallet:** extract ConnectWallet so connect failures have a place to land ([cb36c17](https://github.com/kwami-labs/kwami-x/commit/cb36c1783843c388663be04e6bf7c1d908b86fc5))

### Bug Fixes

- **auth:** deeplink mobile Phantom and surface server status messages ([a5f4109](https://github.com/kwami-labs/kwami-x/commit/a5f4109d9a6f55aa0078547f7a5e9330d9a6e79a))
- **auth:** extract email mode switcher out of the template ([caeb121](https://github.com/kwami-labs/kwami-x/commit/caeb121c35102f927c88a563194ad2d85a30bf84))
- **auth:** narrow Phantom address with instanceof PublicKey ([a41c92a](https://github.com/kwami-labs/kwami-x/commit/a41c92a88e6ed6b94dd0ff0b0a61a2f8affc63b9))
- **auth:** pass full SIWS fields and accept the request host ([f4328f1](https://github.com/kwami-labs/kwami-x/commit/f4328f146399a9291c606d56d8bcb0f2349c7252))
- **build:** inline @noble/* so the server survives its first request ([dd06a7d](https://github.com/kwami-labs/kwami-x/commit/dd06a7dd9fa1663e89035d428da746e2ded3146f))
- **build:** pin eslint to 9 so lint-staged can resolve find-up ([c81b906](https://github.com/kwami-labs/kwami-x/commit/c81b9069542f69ae85be5b8e4cf236506d5f5962))
- **ci:** pin the changelog preset so semantic-release can cut notes ([f2d2137](https://github.com/kwami-labs/kwami-x/commit/f2d213755a79b139f0160128772c6aa0aff61959))
- **eth:** recover addresses on noble v2 and revert Anchor 1.2 ([#43](https://github.com/kwami-labs/kwami-x/issues/43)) ([2649b10](https://github.com/kwami-labs/kwami-x/commit/2649b101f58e7de6a60f70e950444e6ff31d0198))
- **mint:** drive studio parallax from window scroll ([4bfb538](https://github.com/kwami-labs/kwami-x/commit/4bfb538e4b33d85daab9ded74c5586203dfcf0aa))
- **mint:** normalise appearance and voice when writing a draft ([296aaac](https://github.com/kwami-labs/kwami-x/commit/296aaacbe880b4bfb88b709ad4a440c6ab7ce9c8))
- **program:** drop vulnerable rand 0.7.3 from the vault lockfile ([d6dc13e](https://github.com/kwami-labs/kwami-x/commit/d6dc13e631ab8f8ac75cc686967a7d00509ac001))
- **program:** drop vulnerable rand 0.7.3 from the vault lockfile ([737a5ee](https://github.com/kwami-labs/kwami-x/commit/737a5ee5e8be6eb6cb7d83b01c341e1bdd25bf1e))
- **renderer:** extract resolveRendererParams for body switching ([df6c4e1](https://github.com/kwami-labs/kwami-x/commit/df6c4e10bbc2ee590311f7e5ad22689671e5355a))
- **renderer:** import mountKwami as a value, not a type ([9fe845e](https://github.com/kwami-labs/kwami-x/commit/9fe845e22fe46d4043b5e2d212689952535612de))
- **voice:** run the worker on OpenAI until Anthropic has credit ([5d5896e](https://github.com/kwami-labs/kwami-x/commit/5d5896e240b60ba472f8fc65b8a3873cb647c98f))
- **wallet:** stop claiming an install tab that may never have opened ([f69fa1a](https://github.com/kwami-labs/kwami-x/commit/f69fa1afe7bc9718fb917c9b1956843ba56bad8d))
- **wallet:** stop lying about Phantom connect failures ([94b4ef9](https://github.com/kwami-labs/kwami-x/commit/94b4ef9706f28907e48ef93b9d50e5c2aea453ca))

### Performance

- **wallet:** join the detection wait instead of starting a second one ([e67ce09](https://github.com/kwami-labs/kwami-x/commit/e67ce09c6a4e4d392d122ca7c19a7a1eac35abc8))

### Refactoring

- **energy:** extract treasury receipt math into shared helpers ([19521e1](https://github.com/kwami-labs/kwami-x/commit/19521e1d6bdfee311d676d154e51054a8010a5fb))
- **kwami:** rename trait magnitude local to avoid shadowing ([bfc19a5](https://github.com/kwami-labs/kwami-x/commit/bfc19a5b4fc3941454007cff28fff5d5c488d7e6))
- **renderer:** extract camera distance so framing can be tested ([4cb14a6](https://github.com/kwami-labs/kwami-x/commit/4cb14a65ab153ec92772bd96f028de1c5cacf76d))

### Build & Dependencies

- **deps:** bump the minor-and-patch group with 6 updates ([cf3f7b5](https://github.com/kwami-labs/kwami-x/commit/cf3f7b5f9b07cdc423301541c47494c72386a30e))
- **deps:** bump the nuxt group across 1 directory with 2 updates ([#39](https://github.com/kwami-labs/kwami-x/issues/39)) ([b743e1b](https://github.com/kwami-labs/kwami-x/commit/b743e1b3053b28eb558cd7aa9df1e35a3e944af0))
- **deps:** bump the solana group across 1 directory with 3 updates ([#37](https://github.com/kwami-labs/kwami-x/issues/37)) ([b62612e](https://github.com/kwami-labs/kwami-x/commit/b62612e8e2502a58b6617b974b570e78eb6df7b2))
- **program:** bump anchor-lang from 0.31.1 to 1.2.0 in /programs ([#29](https://github.com/kwami-labs/kwami-x/issues/29)) ([78d497a](https://github.com/kwami-labs/kwami-x/commit/78d497ad9b4e0aa5db4eed9ff1b2dad1b7e3443f))
- **program:** bump anchor-spl from 0.31.1 to 1.2.0 in /programs ([#28](https://github.com/kwami-labs/kwami-x/issues/28)) ([31be579](https://github.com/kwami-labs/kwami-x/commit/31be5790b59f3c6b1ca16eef4a496f53ad2499c9))

## [3.1.0](https://github.com/kwami-labs/kwami-x/compare/v3.0.0...v3.1.0) (2026-09-05)

### Features

- **api:** attach the Supabase bearer on authenticated client calls ([aca6e36](https://github.com/kwami-labs/kwami-x/commit/aca6e3682b49887c438c5b4ec8c5c2cb9243ba31))
- **auth:** bind a proven Solana wallet to an existing account ([82cda6c](https://github.com/kwami-labs/kwami-x/commit/82cda6c210fde6cd345b126a9c2ea3da0c13275c))
- **auth:** gate the app with a dismissible overlay over live Kwamis ([66d02b3](https://github.com/kwami-labs/kwami-x/commit/66d02b3b58b16e5423058f7989c61cad557483e5))
- **builder:** stream program generation with a live thinking feed ([0cb6675](https://github.com/kwami-labs/kwami-x/commit/0cb66757a4eaeac97492e0e900b6899542ec480d))
- **kwami:** expose a checkable activity ledger and on-chain accounts ([df3048d](https://github.com/kwami-labs/kwami-x/commit/df3048d9e11d4c441726af6bff2024a8efe65276))
- **mint:** let creators set voice, game mode, palette, and commission ([da7331f](https://github.com/kwami-labs/kwami-x/commit/da7331f6cedc2db920fddfeabf415a16f2f4dfff))

### Bug Fixes

- **demo:** bucket session timestamps to the hour ([ac1185a](https://github.com/kwami-labs/kwami-x/commit/ac1185a0e5908dba40f5bd5eb584812f041bf2b7))
- **renderer:** shade the displaced surface instead of a flat gradient ([9cb42d2](https://github.com/kwami-labs/kwami-x/commit/9cb42d2103dfdc344f48bce9dd614260539f4fbc))

### Refactoring

- **kwami:** centralise appearance as hex and share isConfigured ([bcdc05d](https://github.com/kwami-labs/kwami-x/commit/bcdc05da052b084b14a3f65209b52334989deefc))

### Build & Dependencies

- **deps:** bump @vueuse/core from 13.9.0 to 14.4.0 ([fe29da0](https://github.com/kwami-labs/kwami-x/commit/fe29da00563fef215dc550cb3e383d218d12b8fe))
- **deps:** bump @vueuse/nuxt from 13.9.0 to 14.4.0 ([9c75878](https://github.com/kwami-labs/kwami-x/commit/9c758784d1b074170458f76e03b90c9fbf283cea))
- **deps:** bump pinia from 3.0.4 to 4.0.3 ([f8ac56e](https://github.com/kwami-labs/kwami-x/commit/f8ac56ea89250e1a62c48e1c17a761c94040bdb5))
- **deps:** bump the minor-and-patch group across 1 directory with 2 updates ([8d91b0f](https://github.com/kwami-labs/kwami-x/commit/8d91b0f6d75783c6897a620c6676c30649e812b9))
