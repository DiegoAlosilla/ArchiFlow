import { deflateRawSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

/**
 * Genera el fixture comprimido del importador.
 *
 * draw.io guarda el modelo como base64 de un deflate crudo de la cadena
 * URL-encoded, y esa es justo la ruta que hay que probar: un fixture en claro
 * no ejercitaría la descompresión, que es donde se rompe un importador escrito
 * a ojo. Se genera con un script en vez de a mano para que se pueda regenerar.
 */

const model = `<mxGraphModel dx="1400" dy="900" grid="1">
  <root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
    <mxCell id="carril" value="Canales" style="swimlane;horizontal=0;" vertex="1" parent="1">
      <mxGeometry x="20" y="20" width="640" height="180" as="geometry" />
    </mxCell>
    <mxCell id="movil" value="&lt;b&gt;App M&#243;vil&lt;/b&gt;&lt;br/&gt;iOS" style="rounded=1;fillColor=#dae8fc;" vertex="1" parent="carril">
      <mxGeometry x="60" y="40" width="160" height="60" as="geometry" />
    </mxCell>
    <mxCell id="gw" value="API Gateway" style="shape=hexagon;perimeter=hexagonPerimeter2;" vertex="1" parent="carril">
      <mxGeometry x="300" y="40" width="160" height="60" as="geometry" />
    </mxCell>
    <mxCell id="pantalla" value="Login" style="shape=image;image=data:image/png,iVBORw0KGgo=" vertex="1" parent="1">
      <mxGeometry x="700" y="20" width="120" height="220" as="geometry" />
    </mxCell>
    <mxCell id="bff" value="bff-cuentas" style="rounded=1;" vertex="1" parent="1">
      <mxGeometry x="120" y="280" width="180" height="70" as="geometry" />
    </mxCell>
    <mxCell id="redis" value="Redis sesiones" style="rounded=1;" vertex="1" parent="1">
      <mxGeometry x="420" y="280" width="180" height="70" as="geometry" />
    </mxCell>
    <mxCell id="ora" value="Oracle Clientes" style="shape=cylinder3;boundedLbl=1;" vertex="1" parent="1">
      <mxGeometry x="120" y="420" width="180" height="80" as="geometry" />
    </mxCell>
    <mxCell id="kfk" value="Kafka eventos" style="rounded=1;" vertex="1" parent="1">
      <mxGeometry x="420" y="420" width="180" height="80" as="geometry" />
    </mxCell>
    <mxCell id="nota" value="Pendiente de confirmar con seguridad" style="text;html=1;" vertex="1" parent="1">
      <mxGeometry x="700" y="420" width="200" height="30" as="geometry" />
    </mxCell>
    <mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="movil" target="gw">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="e1l" value="1. POST /login HTTPS" style="edgeLabel;" vertex="1" parent="e1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="e2" value="2. GET /v1/cuentas" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="gw" target="bff">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="e3" value="3. GET sesion:{id}" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="bff" target="redis">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="e4" value="4. SELECT * FROM cuentas" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="bff" target="ora">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="e5" value="5. publish cuentas.consultadas" style="edgeStyle=orthogonalEdgeStyle;dashed=1;" edge="1" parent="1" source="bff" target="kfk">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="e6" value="mockup" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="pantalla" target="movil">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
  </root>
</mxGraphModel>`;

const packed = deflateRawSync(Buffer.from(encodeURIComponent(model), 'utf8')).toString('base64');

const file = `<mxfile host="app.diagrams.net" agent="fixture" version="24.0.0" type="device">
  <diagram id="pagina-1" name="Consulta de cuentas">${packed}</diagram>
</mxfile>
`;

writeFileSync(new URL('../examples/fixtures/consulta-cuentas.drawio', import.meta.url), file);
console.log('escrito examples/fixtures/consulta-cuentas.drawio');
