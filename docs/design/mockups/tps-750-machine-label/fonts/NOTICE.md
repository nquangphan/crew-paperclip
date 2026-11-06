# Bundled UI Fonts

Paperclip bundles Inter for the board UI so screenshots and packaged installs use
the same sans-serif text stack without relying on host font packages.

## Inter

- Upstream project: https://github.com/rsms/inter
- Version: v4.1
- Copyright (c) 2016 The Inter Project Authors (https://github.com/rsms/inter)
- Source file:
  - https://raw.githubusercontent.com/rsms/inter/v4.1/docs/font-files/InterVariable.woff2
- License: SIL Open Font License 1.1
- License text: `LICENSE.txt` in this directory (verbatim copy of
  https://github.com/rsms/inter/blob/v4.1/LICENSE.txt)

Redistribution note: Inter is redistributed under the SIL Open Font License 1.1.
The bundled WOFF2 file is included unmodified from the upstream v4.1 release.

## Bản trong mockup TPS-750

Mockup giữ một bản font riêng để mở độc lập (mở thẳng file HTML, không cần app). File giống hệt bản của app ở
`packages/crew-web/public/fonts/InterVariable.woff2`.

- sha256 của `InterVariable.woff2`: `693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3`
- Kiểm: `shasum -a 256 InterVariable.woff2`
