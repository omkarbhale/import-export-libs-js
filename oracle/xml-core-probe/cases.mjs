// The inputs of the XML core vectors (fixtures/xml-core/vectors.json). `node cases.mjs > cases.json` writes
// the file run.ps1 reads; the recorded .NET results are merged back into vectors.json by record.mjs.
// Ids group the cases: 1.x item-file writer, 2.x manifest writer, 3.x reading, 5.x WebUtility, 6.x file names
// (ticket 06's numbering, appendix B), wf.x well-formedness, xd.x XDocument, xp.x XPath.

import { pathToFileURL } from "node:url";

const cases = [];
const add = (id, kind, fields) => cases.push({ id, kind, ...fields });

// ---- 1: item-file writer (XmlDocument.Save(XmlWriter), PreserveWhitespace = true unless said) ----
const item = (id, text, preserve = true) => add(`1.${id}`, "item-write", { text, preserve });
item("1", '<AML><Item type="Method" id="ABC" action="add"><name>x</name><e/><e2></e2><e3 a="1"/></Item></AML>');
item("2", "<AML><t>lt&lt; gt&gt; amp&amp; quot\" apos' tab&#9; lf&#10; cr&#13; crlf&#13;&#10; ]]&gt; end</t></AML>");
item("3", "<AML><x a=\"lt&lt; gt&gt; amp&amp; quot&quot; apos' tab&#9; lf&#10; cr&#13; crlf&#13;&#10; end\" b='single \"dq\"'/></AML>");
item("4", '<AML><x a="l1\nl2\r\nl3\tt"/></AML>');
item("5", "<AML><t>l1\r\nl2\rl3\nl4</t></AML>");
item("6", '<AML>\n  <Item type="a">\n    <name>x</name>\n  </Item>\n</AML>');
item("6b", '<AML>\n  <Item type="a">\n    <name>x</name>\n  </Item>\n</AML>', false);
item("7", '<AML><Item type="a"><name>x</name>\n<b/><c><d/></c></Item><Item type="b"><c/></Item></AML>');
item("8", '<AML> <Item type="a"><name>x</name></Item><Item type="b"><c/></Item></AML>');
item("9", "<AML><a>text<b/>tail</a><c>only</c><d><e/>tail</d></AML>");
item("10", "<AML><a> </a><b>\n</b><c>  x  </c></AML>");
item("11", '<AML><Item><method_code><![CDATA[line1\nline2\r\nline3 <tag> & "q" ]]></method_code><e><![CDATA[]]></e><f><![CDATA[a]]><![CDATA[b]]></f></Item></AML>');
item("12", "<AML><a>pre<![CDATA[c]]>post</a><b><x/><![CDATA[c]]></b></AML>");
item("13", "<AML><!-- Please note --><Item><!--c2--><name>x</name><!-- c3 --></Item><z><!--only--></z></AML>");
item("14", '<AML><t a="&#233;&#160;&#252;&#x2028;">&#233;&#160;&#x2028;&#x85;&#x1F600;&#xFFFD;</t></AML>');
item("15", "<AML/>");
item("15b", "<AML></AML>");
item("16", '<AML xmlns:x="urn:x"><Item x:b="1" type="a"><x:c/></Item></AML>');
item("17", '<AML><a xml:space="preserve">  <b/>  </a></AML>', false);
item("18", '<AML><Item type="a"><Relationships><Item type="b"><related_id><Item type="c"><name>n</name></Item></related_id></Item></Relationships></Item></AML>');
item("19", "<AML><?pi data?><a/></AML>");
item("20", "<AML><a/></AML>\n");
// beyond ticket 06
item("21", '<?xml version="1.0" encoding="utf-8"?><AML><a/></AML>');
item("22", "<!DOCTYPE AML><AML><a/></AML>");
item("23", "<!-- before --><AML><a/></AML><!-- after -->");
item("24", "<AML><a>x</a>\n<!--c--><b/></AML>");
item("25", "<AML><a><!--c-->text</a><b>text<!--c--></b></AML>");
item("26", '<AML><Item xmlns="urn:def" a="1"><b/></Item><c xmlns:p="urn:p" p:a="1" xmlns:q="urn:q"/></AML>');
item("27", "<AML><a>&#1;</a></AML>");
item("28", '<AML><a b="&#1;"/></AML>');
item("29", "<AML><a>&#xFFFE;</a></AML>");
item("30", "<AML><a>x&#xD800;y</a></AML>");
item("31", "<AML><a>x&#xDC00;y</a></AML>");
item("32", "<AML><a>&#xD800;</a></AML>");
item("33", "<AML><a><![CDATA[x&#1;]]></a><b>&#9;&#10;&#13;</b></AML>");
item("34", "<AML><?pi a\r\nb?><!--c\r\nd--></AML>");
item("35", "<AML><a>\t</a><b>\r</b><c> \n </c></AML>");
item("36", '<AML><a x="1"  y = "2"   ></a><b/></AML>');
item("37", "<AML><a>x</a>  <b>y</b></AML>");
item("38", "<AML><a><b>x</b>  </a><c><d/></c></AML>");
item("39", "<AML>\r\n<Item>\r\n<a/>\r\n</Item>\r\n</AML>");
item("40", '<AML><a xml:lang="en" xml:space="default">x</a></AML>');
item("41", "<AML><a>a&amp;b&lt;c&gt;d&quot;e&apos;f</a></AML>");
item("42", '<AML><a b="a&amp;b&lt;c&gt;d&quot;e&apos;f"/></AML>');
item("43", "<AML><a>\u00a0\u0085\u2028\ud83d\ude00</a></AML>");
item("44", "<AML><a><![CDATA[a]]]]><![CDATA[>b]]></a></AML>");
item("45", "<AML><!----><a><!-- - --></a></AML>");
item("46", "<AML><a/><b></b><c>\n</c><d> </d></AML>");
item("47", "<AML><x:a xmlns:x='urn:x'><x:b/></x:a></AML>");
item("48", "<AML>\n<a>\n<b>x</b>\n</a>\n</AML>", false);
// pipeline vectors: the engine's transform output after the xmlns:SOAP-ENV strip (ticket 06 section 4)
const SOAP = ' xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"';
const stripped = (id, xsl) => add(`4.${id}`, "item-write", { text: xsl.split(SOAP.slice(1)).join(""), preserve: true });
stripped(
  "a2",
  `<AML><Item type="Method" id="M1" action="add" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><name>m</name><method_code><![CDATA[a]]]]><![CDATA[>b <x> &\r\nline2]]></method_code><comments /><label /></Item></AML>`,
);
stripped(
  "a5",
  `<AML><Item type="List" id="L1" action="add" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">\r\n  <name>l</name>\r\n  <Relationships>\r\n    <Item type="Value" id="V1" action="add"><value>a</value></Item>\r\n  </Relationships>\r\n</Item></AML>`,
);
stripped(
  "b3",
  `<AML><Item type="Report" id="R1" action="add" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><name>r</name><method is_null="1" keyed_name=""><Item type="Method" action="get" select="id"><name></name></Item></method><description is_null="1" /><xp-a is_null="1" /></Item></AML>`,
);
stripped(
  "b4",
  `<AML><Item type="ItemType" id="T1" action="add" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><name>t</name><Relationships><Item type="Property" id="P2" action="add"><name>mine</name><is_keyed>0</is_keyed><data_type>string</data_type><source_id>T1</source_id></Item></Relationships></Item><Item type="ItemType" id="T1" action="edit" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><Relationships><Item type="Property" action="edit" where="source_id='T1' and name='sort_order'"><name>sort_order</name><is_keyed>1</is_keyed><source_id>T1</source_id></Item></Relationships></Item><Item type="View" action="delete" where="source_id='T1'" /><Item type="Form" action="delete" where="name='t'" /></AML>`,
);
stripped(
  "d2",
  `<AML><Item type="ItemType" id="T1" action="add" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><name>t</name><Relationships><Item type="DiscussionTemplate" id="D1" action="add"><Relationships><Item type="FeedTemplate" id="F1" action="add"><Relationships><Item type="FileSelectorTemplate" id="S1" action="add"><reference><![CDATA[<Item type="x"/> &amp;]]></reference></Item></Relationships></Item></Relationships></Item></Relationships></Item><Item type="View" action="delete" where="source_id='T1'" /><Item type="Form" action="delete" where="name='t'" /></AML>`,
);
stripped(
  "f1",
  `<AML><Item type="List" action="add" id="L" /><Item type="Method" action="add" id="M"><method_code><![CDATA[x]]]]><![CDATA[>y]]></method_code><name>m</name></Item></AML>`,
);
stripped(
  "x2",
  `<AML><Item type="Method" id="M1" action="add" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><name>m</name><method_code><![CDATA[var s = '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">';]]></method_code><comments>xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"</comments><label a="xmlns:SOAP-ENV=&quot;http://schemas.xmlsoap.org/soap/envelope/&quot;">x</label></Item></AML>`,
);
add("4.x5", "item-write", {
  text: `<AML><Item type="ItemType" id="T1" action="add"><name>t</name><Relationships><Item type="DiscussionTemplate" id="D1" action="add"><Relationships><Item type="FeedTemplate" id="F1" action="add"><Relationships><Item type="FileSelectorTemplate" id="S1" action="add"><reference><![CDATA[a]]>b]]></reference></Item></Relationships></Item></Relationships></Item></Relationships></Item></AML>`,
  preserve: true,
});

// ---- 2: manifest writer (XmlDocument.Save(path); loaded with LoadXml, PreserveWhitespace = false unless said) ----
const man = (id, text, preserve = false) => add(`2.${id}`, "manifest-write", { text, preserve });
man("1", "<imports/>");
man(
  "2",
  '<imports><package name="com.aras.innovator.solution.PLM" path="PLM\\Import"><dependson name="com.aras.innovator.core"><referenced_element id="ABC" type="ItemType" descr="Part &amp; &lt;&quot;Doc&quot;&gt; \'q\' \u00e9\u00a0 tab&#9; lf&#10; cr&#13;"/></dependson><dependson name="com.aras.innovator.admin"/></package><package name="com.aras.innovator.core" path=".\\"/></imports>',
);
man("3", '<imports>\r\n  <package name="a" path="a\\Import">\r\n    <dependson name="b" />\r\n  </package>\r\n</imports>');
man("4", '\ufeff<?xml version="1.0" encoding="utf-8"?>\r\n<imports>\r\n\t<package name="a" path="a\\Import"/>\r\n</imports>');
man("4b", '<?xml version="1.0" encoding="utf-8"?>\r\n<imports>\r\n\t<package name="a" path="a\\Import"/>\r\n</imports>');
man("5", '<?xml version="1.0" encoding="utf-16"?><imports><package name="a"/></imports>');
man("6", '<?xml version="1.0"?><imports><package name="a"/></imports>');
man("7", '<?xml version="1.0" encoding="windows-1252"?><imports><package name="caf\u00e9"/></imports>');
man("8", '<?xml version="1.0" encoding="us-ascii"?><imports><package name="caf\u00e9"/></imports>');
man("9", '<?xml version="1.0" standalone="yes"?><imports/>');
man("10", '<?xml version="1.0" encoding="UTF-8"?><imports/>');
man("11", '<?xml version="1.0" encoding="iso-8859-1"?><imports><package name="caf\u00e9"/></imports>');
man("12", '<imports><t>a\rb\r\nc\nd&gt;e]]&gt;f\tg</t><!--k--></imports>');
man("13", '<imports>\n <package name="a" />\n</imports>', true);
man("14", "<imports><a>t<b><c/></b>u</a><d><![CDATA[x<y]]></d></imports>");
man("15", '<imports><a xml:space="preserve">  <b/>  </a><c> </c></imports>');
man("16", "<imports><?pi data?><!--c--><a/></imports>");
man("17", "<!DOCTYPE imports><imports><a/></imports>");
man("18", '<imports><a b="x&#9;y&#10;z&#13;w"/><e></e><f/></imports>');
man("19", '<imports xmlns:x="urn:x"><x:a x:b="1"/><c xmlns="urn:d"/></imports>');
man("20", "<imports><a>  x  </a><b>\n</b></imports>");
man("21", "<imports>\n  <!-- c -->\n  <a/>\n</imports>");
man("22", "<imports><a>text</a><b/>\n</imports>");
man("23", "<imports><a><![CDATA[]]></a><b><![CDATA[x]]></b></imports>");
man("24", "<imports><a>\u00e9\u00a0\u2028\ud83d\ude00</a><b c=\"\u00e9\u00a0\u2028\ud83d\ude00\"/></imports>");

// ---- 3: reading (File.ReadAllText + LoadXml) ----
const bytes = (...parts) => Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "utf8") : Buffer.from(p)))).toString("hex").toUpperCase();
const utf16le = (s) => Buffer.from(s, "utf16le");
const utf16be = (s) => Buffer.from(s, "utf16le").swap16();
const utf32 = (s, be) => {
  const out = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    const b = Buffer.alloc(4);
    be ? b.writeUInt32BE(cp) : b.writeUInt32LE(cp);
    out.push(b);
  }
  return Buffer.concat(out);
};
const read = (id, ...parts) => add(`3.${id}`, "read-bytes", { hex: bytes(...parts) });
const aml = '<AML><Item type="a"><name>\u00e9\u00fc</name></Item></AML>';
read("utf8-bom", [0xef, 0xbb, 0xbf], aml);
read("utf8-nobom", aml);
read("utf16le-bom", [0xff, 0xfe], utf16le(aml));
read("utf16be-bom", [0xfe, 0xff], utf16be(aml));
read("utf32le-bom", [0xff, 0xfe, 0, 0], utf32(aml, false));
read("utf32be-bom", [0, 0, 0xfe, 0xff], utf32(aml, true));
read("utf16le-nobom", utf16le(aml));
read("latin1-nobom", Buffer.from(aml, "latin1"));
read("cp1252-decl-latin1", Buffer.from(`<?xml version="1.0" encoding="windows-1252"?>${aml}`, "latin1"));
read("utf8-decl-bom", [0xef, 0xbb, 0xbf], `<?xml version="1.0" encoding="utf-8"?>${aml}`);
read("utf16-decl-utf8", `<?xml version="1.0" encoding="utf-16"?>${aml}`);
read(
  "ws-cdata-comment",
  [0xef, 0xbb, 0xbf],
  '<AML>\r\n  <Item type="a">\r\n    <name>  x  </name>\r\n    <c>  <![CDATA[ y ]]>  </c>\r\n    <!-- c -->\r\n    <s xml:space="preserve">  </s>\r\n    <e>   </e>\r\n  </Item>\r\n</AML>\r\n',
);
read("leading-ws", [0xef, 0xbb, 0xbf], '\r\n  <AML><Item type="a"/></AML>');
read("doctype-internal", [0xef, 0xbb, 0xbf], '<!DOCTYPE AML [<!ENTITY e "EXP">]><AML><Item type="a"><n>&e;</n></Item></AML>');
read("nul", "<AML><Item type=\"a\"><n>", [0x01], "</n></Item></AML>");
read("invalid-utf8", "<A>", [0xc3, 0x28, 0xff], "</A>");
read("attr-normalization", '<AML><Item type=" a\r\n\tb " x="&#10;"/></AML>');
// the replacement character count per invalid sequence
const invalid = {
  "c3-eof": [0xc3],
  "c3-28": [0xc3, 0x28],
  "e2-82-eof": [0xe2, 0x82],
  "e2-82-28": [0xe2, 0x82, 0x28],
  "e2-82-41": [0xe2, 0x82, 0x41],
  "f0-9f-98-eof": [0xf0, 0x9f, 0x98],
  "f0-9f-98-28": [0xf0, 0x9f, 0x98, 0x28],
  "lone-80": [0x80],
  "80-80": [0x80, 0x80],
  "c0-80": [0xc0, 0x80],
  "c1-bf": [0xc1, 0xbf],
  "e0-80-80": [0xe0, 0x80, 0x80],
  "e0-9f-bf": [0xe0, 0x9f, 0xbf],
  "ed-a0-80": [0xed, 0xa0, 0x80],
  "ed-bf-bf": [0xed, 0xbf, 0xbf],
  "f0-80-80-80": [0xf0, 0x80, 0x80, 0x80],
  "f4-90-80-80": [0xf4, 0x90, 0x80, 0x80],
  "f5-80-80-80": [0xf5, 0x80, 0x80, 0x80],
  "f8-88-80-80-80": [0xf8, 0x88, 0x80, 0x80, 0x80],
  "fe-ff": [0xfe, 0xff],
  "ff": [0xff],
  "valid-then-c3": [0xc3, 0xa9, 0xc3],
  "e2-82-ac-80": [0xe2, 0x82, 0xac, 0x80],
  "f0-9f-98-80-ok": [0xf0, 0x9f, 0x98, 0x80],
  "ef-bf-be": [0xef, 0xbf, 0xbe],
  "f4-8f-bf-bf": [0xf4, 0x8f, 0xbf, 0xbf],
};
for (const [name, seq] of Object.entries(invalid)) read(`bad-${name}`, "<a>x", seq, "y</a>");


// more reading errors: where the invalid bytes end the file
const tail = {
  "c3": [0xc3], "e2-82": [0xe2, 0x82], "f0-9f-98": [0xf0, 0x9f, 0x98], "e0-80": [0xe0, 0x80], "f0": [0xf0], "80-80-80": [0x80, 0x80, 0x80],
};
for (const [name, seq] of Object.entries(tail)) read(`bad-end-${name}`, "<a>x</a>\n<!--", seq);
read("utf16le-odd", [0xff, 0xfe], utf16le("<a>x</a>"), [0x41]);
read("utf16le-lone-high", [0xff, 0xfe], utf16le("<a>"), [0x3d, 0xd8], utf16le("x</a>"));
read("utf16le-lone-low", [0xff, 0xfe], utf16le("<a>"), [0x00, 0xdc], utf16le("x</a>"));
read("utf16be-lone-high", [0xfe, 0xff], utf16be("<a>"), [0xd8, 0x3d], utf16be("x</a>"));
read("utf32le-astral", [0xff, 0xfe, 0, 0], utf32("<a>\u{1F600}</a>", false));
read("utf32le-too-big", [0xff, 0xfe, 0, 0], utf32("<a>", false), [0, 0, 0x11, 0], utf32("</a>", false));
read("bom-only-utf8", [0xef, 0xbb, 0xbf]);
read("bom-only-utf16", [0xff, 0xfe]);
read("empty");
read("one-byte", [0x3c]);
read("fffe-start", [0xff, 0xfe, 0x00]);
read("double-bom", [0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf], "<a/>");

// ---- 5: WebUtility ----
add("5.entities", "html-entities", {});
add("5.encode-changed", "html-encode-changed", {});
const enc = (id, text) => add(`5.e${id}`, "html-encode", { text });
[
  "\ud83d\ude00", "\u2028", "\ufffd", "a&b<c>d\"e'f", "&amp;", "", "\t\r\n", "\u00a0\u00ff\u0100", "\u20ac\u0152",
  "x\ud83d\ude00y", "\u007f\u0080\u009f",
].forEach((t, i) => enc(i + 1, t));
const dec = (id, text) => add(`5.d${id}`, "html-decode", { text });
[
  "&nbsp;&copy;&eacute;&euro;&apos;&quot;&lt;&gt;&amp;",
  "&#160;&#xA0;&#XA0;&#x1F600;&#128512;&#0;&#65;",
  "&amp;lt;",
  "&unknown; & &lt &#; &#x; &#xZZ;",
  "&NBSP;&Nbsp;",
  "&nbsp",
  "&#1114112;&#xD800;",
  '&lt;a b=&quot;1&quot;/&gt;',
  "&#65535;&#xFFFF;&#xFFFE;&#65536;&#x10000;",
  "&#00065;&#x0041;&#+65;&#-65;&#65 ;",
  "&#1;&#8;&#127;&#128;&#159;",
  "&amp;&amp;amp;&amp;#65;",
  "&;&&;&a;&aa;&amp",
  "&Eacute;&AMP;&Amp;&LT;",
  "&#xd7ff;&#xe000;&#x10ffff;&#x110000;&#xFFFFFFFF;&#4294967295;&#99999999999;",
  "text &amp; more &lt;b&gt; &#233; &euro;",
  "&thetasym;&upsih;&piv;&bull;&hellip;&prime;&Prime;&oline;&frasl;&weierp;&image;&real;&trade;&alefsym;",
  "&rarr;&crarr;&lArr;&hArr;&forall;&part;&exist;&empty;&nabla;&isin;&notin;&ni;&prod;&sum;&minus;&lowast;&radic;&prop;&infin;&ang;&and;&or;&cap;&cup;&int;&there4;&sim;&cong;&asymp;&ne;&equiv;&le;&ge;&sub;&sup;&nsub;&sube;&supe;&oplus;&otimes;&perp;&sdot;&lceil;&rceil;&lfloor;&rfloor;&lang;&rang;&loz;&spades;&clubs;&hearts;&diams;",
].forEach((t, i) => dec(i + 1, t));

// ---- 6: file names ----
add("6.invalid-file-name-chars", "file-names", {});

// ---- wf: well-formedness, positions and messages (LoadXml) ----
const wf = (id, text, preserve = true) => add(`wf.${id}`, "load", { text, preserve });
const wfs = [
  '<a b="1" b="2"/>', "<a>", "<a></b>", "<a x=1/>", "<a>]]></a>", "<1a/>", "<a>&unknown;</a>", "<p:a/>", "<a/><b/>", "x<a/>",
  '<a b="<"/>', "<a>&#1;</a>", "<a>\u0001</a>", '<a b="&#1;"/>', "<a>&#xD800;</a>", "<a>&#xFFFE;</a>", "<a><!-- a -- b --></a>",
  "<a><?xml x?></a>", ' <?xml version="1.0"?><a/>', "<!DOCTYPE a><a/>", '<a xmlns:p=""/>', "<a>&amp</a>", "<a b='1'c='2'/>",
  "<a\u00a0/>", '<AML><?xml version="1.0"?><Item/></AML>', "<AML><!DOCTYPE x><Item/></AML>", "<a></a >", "<a/ >", '<a b = "1" />',
  "<a>\uffff</a>", "", "   ", "<a>text", "<a><b>", "<a", '<a b="1', "<a b", "<a b=", "<!--", "<!-- x", "<![CDATA[x", "<a><![CDATA[x", "<a>&", "<a>&#",
  "<a/>x", "<a/> x", "<a/><!--c-->", "<a/><?pi?>", "<a/>\n", "<!--c--><a/>", "<?pi?><a/>", "<a/><!DOCTYPE a>", "<a><!DOCTYPE a></a>",
  "<!DOCTYPE a><!DOCTYPE b><a/>", "<![CDATA[x]]><a/>", "<a/><![CDATA[x]]>", "</a>", "<a/></a>", "< a/>", "<a >", "<a\n b=\"1\"\r\n/>",
  "<a:b:c/>", "<:a/>", "<a:/>", "<a b:c='1'/>", "<a xmlns:b='u' b:c='1' b:c='2'/>", "<a xmlns:b='u' xmlns:c='u' b:x='1' c:x='2'/>",
  '<a xmlns:xml="x"/>', '<a xmlns:xml="http://www.w3.org/XML/1998/namespace"/>', '<a xmlns:xmlns="u"/>', '<a xmlns="u"><b xmlns=""/></a>',
  '<a xml:lang="en"/>', '<a xmlns:p="u" p:x="1"/>', "<a p:x='1'/>", '<a xmlns:p="u"><p:b/><c/></a>', '<a xmlns:p="u"/><b/>',
  "<a>&#0;</a>", "<a>&#x110000;</a>", "<a>&#65;&#x41;</a>", "<a>&#X41;</a>", "<a>&#;</a>", "<a>&#x;</a>", "<a>&#12a;</a>", "<a>&#xZ;</a>",
  "<a>&lt;&gt;&amp;&quot;&apos;</a>", "<a>&LT;</a>", "<a>&nbsp;</a>", "<a b='&nbsp;'/>", "<a b='&amp;&lt;&#65;'/>", '<a b="&"/>', '<a b="&amp"/>',
  "<a b='x'y'/>", '<a b="x"y"/>', "<a b=\"it's\"/>", "<a b='say \"hi\"'/>", "<a b=\"\"/>", "<a b=''/>", "<a b/>", "<a =\"1\"/>",
  "<!---->", "<a><!----></a>", "<a><!-- - --></a>", "<a><!---></a>", "<a><!-- a--->", "<a><!--a---></a>", "<a><!-- a - b --></a>",
  "<a><![CDATA[]]></a>", "<a><![CDATA[]]]]><![CDATA[>]]></a>", "<a><![CDATA[a]b]]c]]></a>", "<a><![CDATA[<>&]]></a>", "<a><![CDATA[ x ]]></a>",
  "<a><?pi?></a>", "<a><?pi data ?></a>", "<a><?pi\tdata?></a>", "<a><?pi?>x</a>", "<a><?PI x?></a>", "<a><?x-y z?></a>", "<a><??></a>", "<a><? x?></a>",
  "<a><?xml?></a>", "<a><?XML x?></a>", "<a><?xmlx x?></a>", "<a><?pi data</a>",
  '<?xml version="1.0"?><a/>', '<?xml version="1.0" encoding="utf-8"?><a/>', '<?xml version="1.0" encoding="utf-8" standalone="yes"?><a/>',
  '<?xml version="1.1"?><a/>', '<?xml version="2.0"?><a/>', '<?xml encoding="utf-8"?><a/>', "<?xml?><a/>", '<?xml version="1.0"', '<?xml version="1.0"?',
  "<?xml version='1.0'?><a/>", '<?xml  version="1.0"  ?><a/>', '<?xml version="1.0"?>\n<a/>', '<?xml version="1.0"?> <a/>', '<?xml version="1.0" foo="x"?><a/>',
  '<?xml standalone="yes" version="1.0"?><a/>', '<?xml version="1.0" encoding="bogus"?><a/>',
  "\ufeff<a/>", "<a>\ufeff</a>", "<a>\u0000</a>", "<a>\u0008</a>", "<a>\u000b</a>", "<a>\u000c</a>", "<a>\u001f</a>", "<a>\u007f</a>", "<a>\u0080</a>",
  "<a>\ud83d\ude00</a>", "<\ud83d\ude00/>", "<a\ud83d\ude00/>",
  "<a\u00e9/>", "<\u00e9a/>", "<a-b.c_d/>", "<a.b/>", "<-a/>", "<.a/>", "<_a/>", "<a\u00b7/>", "<\u00b7a/>", "<a\u2028/>", "<a\u0301/>",
  "<a>\u00a0</a>", "<a>\u2028</a>", "<a>\u0085</a>",
  "<a>1</a>\n<b>2</b>", "<a>\r\n<b>\r\n</b>\r\n</a>", "line1\nline2<a/>", "<a>\r\n\r\n</b></a>", "<a>\n\n\n<b></c></a>", "<a>\r<b></c></a>", "<a>\r\n<b b='1' b='2'/></a>",
  "<a>\n  <b>\n    <c d='1' d='2'/>\n  </b>\n</a>", "<a>\n\t<b\n\td='1'\n\td='2'/></a>",
  "<a><b></a></b>", "<a><b/></c>", "<a></a></a>", "<a><b></b></a>junk", "<a><b/>text<c/></a>", "<root><a/><a/></root><root/>",
  "<a b='1' c='2' b='3'/>", "<a  b='1'  />", "<a b = '1'/>", "<a b= '1'/>", "<a b ='1'/>", "<a\tb='1'/>", "<a\nb='1'/>", "<a\r\nb='1'/>", "<a b='1'\n/>",
  "<a>]</a>", "<a>]]</a>", "<a>]]]></a>", "<a>a]]>b</a>", "<a b=']]>'/>", "<a><![CDATA[x]]>]]></a>", "<a>\n]]>\n</a>",
  "<a x='1'/ >", "<a/", "<a/x", "</", "<", "<>", "<a>>", "<a b=>", "<a b='>", "<a <b/>", "<a b='1' <c/>", "<a&b/>", "<a;/>",
  "<!DOCTYPE>", "<!DOCTYPE a", "<!DOCTYPE a [", "<!DOCTYPE a [<!ELEMENT a ANY>]><a/>", '<!DOCTYPE a SYSTEM "a.dtd"><a/>', '<!DOCTYPE a PUBLIC "x" "y"><a/>',
  "<!doctype a><a/>", "<!DOCTYPE a><a/><!DOCTYPE b>",
  "<a><!ELEMENT x></a>", "<!ELEMENT a ANY><a/>", "<![if x]><a/>",
  "<a>\u0000</a>".replace("\u0000", "\u2400"),
];
wfs.forEach((t, i) => wf(String(i + 1).padStart(3, "0"), t));
// preserveWhitespace = false (ticket 06 rule R5)
const wfn = (id, text) => wf(`n${id}`, text, false);
[
  '<AML>\r\n  <Item type="a">\r\n    <name>  x  </name>\r\n    <c>  <![CDATA[ y ]]>  </c>\r\n    <!-- c -->\r\n    <s xml:space="preserve">  </s>\r\n    <e>   </e>\r\n  </Item>\r\n</AML>\r\n',
  "<a>  <b/>  </a>", '<a xml:space="preserve">  <b/>  </a>', '<a xml:space="preserve"> <b xml:space="default"> <c/> </b> </a>',
  '<a xml:space="default"> <b/> </a>', "<a> &#32; </a>", "<a>&#9;</a>", "<a> <![CDATA[ ]]> </a>", "<a><![CDATA[ ]]></a>", "<a> <!--c--> </a>",
  "<a> <?pi?> </a>", "<a>\n</a>", "<a>  x  </a>", "<a>  <b>  x  </b>  </a>", "<a>x<b/>  </a>", "<a>  <b/>x</a>", "<a>\r\n</a>",
  "<a> \t\r\n </a>", "<a>&#10;</a>", "<a>&#13;</a>", "<a>&#x20;</a>", "<a> &amp; </a>", "<a> <b/> <c/> </a>", "<a/>  ", "  <a/>  ", "<!--c-->  <a/>  <!--d-->",
  '<a xml:space="preserve"><![CDATA[ ]]> </a>', '<a xml:space="preserve">\n</a>', '<a xml:space="bogus"> </a>', '<a xml:space="preserve"/>',
  '<a><b xml:space="preserve"> </b> </a>', '<a xml:space="preserve"> <b> </b> </a>', "<a>\u00a0</a>", "<a>\u2003</a>", "<a>\u0085</a>",
].forEach((t, i) => wfn(String(i + 1).padStart(2, "0"), t));
// attribute and text normalisation: nothing is normalised (ticket 08, F1)
[
  '<a x="1\r\n2\r3\n4\t5" y="&#13;&#10;&#9;">t1\r\nt2\rt3\nt4<![CDATA[c1\r\nc2\rc3]]><!--m1\r\nm2--></a>',
  "<a x='  lead  trail  '/>", '<a x="a\u00a0b\u2028c"/>', '<a x="\r"/>', '<a x="\n"/>', '<a x="\t"/>', '<a x="\r\n"/>', '<a x="&#13;&#10;"/>',
  '<a x="a&#32;&#32;b"/>', "<a>\r</a>", "<a>\r\n</a>", "<a>x\ry</a>", "<a><![CDATA[x\ry]]></a>", "<a><?pi x\ry?></a>", "<a><!--x\ry--></a>",
  '<a x="1" y="2"\r\nz="3"/>',
].forEach((t, i) => wf(`norm${String(i + 1).padStart(2, "0")}`, t));
// every XML whitespace and name character class at the edges
add("wf.empty-doc-ws-preserve-false", "load", { text: "   ", preserve: false });

// ---- xd: XDocument.Parse(text).ToString() ----
const xd = (id, text) => {
  add(`xd.${id}`, "xdoc", { text, mode: "indent" });
  add(`xd.${id}n`, "xdoc", { text, mode: "none" });
};
[
  '<Item type="x" action="get"><a>1</a><b/><c></c><d> t </d><!--c--><e><![CDATA[z<]]></e><f a="l1&#10;l2" g=\'q"\'/></Item>',
  "<Item>\n    <a>1</a>\n</Item>",
  '<?xml version="1.0" encoding="utf-8"?><Item><a>&#233;&#160;</a></Item>',
  "<Item><m>t<b/>u</m></Item>",
  "<a/>", "<a></a>", "<a>x</a>", "<a> </a>", "<a>\n</a>", "<a><b/><c/></a>", "<a><b><c/></b></a>", "<a>t<b/></a>", "<a><b/>t</a>",
  "<a><!--c--></a>", "<a><!--c--><b/></a>", "<a><![CDATA[x]]></a>", "<a><![CDATA[x]]><b/></a>", "<a><![CDATA[]]></a>", "<a><?pi x?></a>", "<a><?pi?></a>",
  '<a b="1" c=\'2\'/>', '<a b="a&amp;b&lt;c&gt;d&quot;e&apos;f"/>', '<a b="\t\r\n"/>', '<a b="x\ty"/>', '<a b="x\ny"/>', '<a b="x\r\ny"/>', '<a b="x&#9;y"/>',
  "<a>x\ty</a>", "<a>x\ny</a>", "<a>x\r\ny</a>", "<a>x\ry</a>", "<a>a&amp;b&lt;c&gt;d\"e'f</a>", "<a>]]&gt;</a>",
  '<a xmlns:p="urn:p"><p:b p:c="1"/></a>', '<a xmlns="urn:d"><b/></a>', '<a xmlns:p="urn:p" xmlns:q="urn:q"><p:b/><q:c/></a>',
  '<a xml:space="preserve">  <b/>  </a>', '<a xml:space="preserve"> </a>', "<a>  <b/>  </a>", "<a>\r\n  <b>\r\n    <c/>\r\n  </b>\r\n</a>",
  "<!DOCTYPE a><a/>", "<!--before--><a/><!--after-->", "<?pi x?><a/>", "<a/><b/>", "", "  ", "<a>", "x<a/>", "<a/>x",
  "<a>\u00e9\u00a0\u2028\ud83d\ude00</a>", '<a b="\u00e9\u00a0\u2028\ud83d\ude00"/>', "<a>&#1;</a>", "<a>&#xD800;</a>", "<a>\u0001</a>",
  "<a><b>1</b><b>2</b><c>3</c></a>", "<a>one<b>two</b>three<c/>four</a>", "<a><b>text</b>tail<c><d/></c></a>",
  "<a>\n  <b>x</b>\n  <c>y</c>\n</a>", "<a>\t<b/>\t</a>",
  '<Item type="x"><a>  </a><b>\n</b></Item>',
].forEach((t, i) => xd(String(i + 1).padStart(2, "0"), t));

// ---- xp: XPath (XPathNavigator.Evaluate with an XmlNamespaceManager) ----
const SOAPDOC =
  '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i18n="http://www.aras.com/I18N"><SOAP-ENV:Body><Result>' +
  '<Item type="ItemType" id="T1" keyed_name="Part"><name>Part</name><label xml:lang="en">Part</label><i18n:label xml:lang="de">Teil</i18n:label>' +
  '<Relationships><Item type="Property" id="P1"><name>name</name><data_type>string</data_type><data_source is_null="1"/><source_id>T1</source_id></Item>' +
  '<Item type="Property" id="P2"><name>owner</name><data_type>item</data_type><data_source keyed_name="User" type="ItemType">U1</data_source><source_id>T1</source_id></Item>' +
  '<Item type="Property" id="P3"><name>x</name><source_id>RT1</source_id></Item></Relationships></Item>' +
  "</Result></SOAP-ENV:Body></SOAP-ENV:Envelope>";
const AMLDOC =
  '<AML><Item type="Method" id="M1" action="add"><name>m</name><method_code><![CDATA[var a = 1;]]></method_code></Item>' +
  '<Item type="List" id="L1" action="add"><name>l</name><Relationships><Item type="Value" id="V1"><value>a</value><source_id>RT1</source_id></Item></Relationships></Item>' +
  '<Item type="Method" id="M2"><name>m2</name><is_null_child is_null="1"/><xp-a is_null="1"/><b is_null="1"/></Item></AML>';
const MANDOC =
  '<imports><package name="com.aras.innovator.solution.PLM" path="PLM\\Import"><dependson name="com.aras.innovator.core"><referenced_element id="ABC" type="ItemType" descr="d"/></dependson><dependson name="com.aras.innovator.admin"/></package><package name="com.aras.innovator.core" path=".\\"/></imports>';
const MIXDOC =
  "<r><s>RT1</s><s><![CDATA[RT1]]></s><s>R<![CDATA[T1]]></s><s>RT1<!--c--></s><s>x</s><e/><e> </e><n>12</n><n>-3.5</n><n>abc</n><t>  a  b  </t></r>";
const xp = (id, doc, expr, extra = {}) => add(`xp.${id}`, "xpath", { text: doc, expr, ...extra });
let xpi = 0;
const xps = (doc, ...exprs) => exprs.forEach((e) => xp(String(++xpi).padStart(3, "0"), doc, e));
xps(
  SOAPDOC,
  "//*[local-name()='Envelope']/*[local-name()='Body']/*[local-name()='Result']/Item",
  "//*[local-name()='Result']/Item/Relationships/Item",
  "Envelope/Body/Result/Item", "//Result/Item", "//Item", "//Item[@type='Property']", "//Item[@type='Property' and data_source!='']",
  "//Item[@type='Property' and data_source]", "//Item[@type!='Property']", "//Item[not(@type='Property')]", "//Item[data_source/@is_null='1']",
  "//Item/Relationships/Item/name", "//Item/*/@xml:lang", "//*[@xml:lang='de']", "//label", "//*[local-name()='label']", "//i18n:label",
  "//*[namespace-uri()='http://www.aras.com/I18N']", "//@*", "//@type", "//Item[1]", "(//Item)[2]", "//Item[last()]", "//Item[position()>1]",
  "count(//Item)", "count(//Item[@type='Property'])", "//Item[name='name']/@id", "//Item[source_id='T1']", "//Item[source_id/text()='T1']",
  "not(//Item/source_id/text()='T1')", "//Item[contains(name,'a')]", "//Item[starts-with(name(),'I')]", "//*[starts-with(name(),'SOAP-ENV:')]",
  "//Item/name | //Item/label", "//label | //name", "name(/*)", "local-name(/*)", "namespace-uri(/*)", "string(//Item/@id)", "string(//name)",
  "//Result/Item/Relationships/Item/data_source[@is_null='1']/..", "//Item[@id='P2']/data_source/@keyed_name", "//Item/ancestor::Item",
  "//Item/following-sibling::Item", "//name/preceding-sibling::*", "//data_source/parent::Item/@id", "//*[count(*)=0]", "//*[count(*)=0 and not(text())]",
  "//comment()", "//processing-instruction()", "//text()", "//Relationships/*", "//Relationships/node()", "/", "/*", ".", "..", "//Item[@id='P1']/../..",
  "//Item[data_source!='']/@id", "//Item[data_source='']/@id", "//Item[data_source='U1']/@id", "//data_source[. != 'U1']", "//nothing != ''", "not(//nothing = '')",
);
xps(
  AMLDOC,
  "AML/Item", "/AML/Item[@type='Method']", "//Item[@type='Method'][name='m2']/*", "//Item[@type='Method']/*[@is_null='1']",
  "node()[@is_null='1'][not(starts-with(name(),'xp-'))]", "//Item[@id='M2']/node()[@is_null='1'][not(starts-with(name(),'xp-'))]",
  "//method_code/text()", "//method_code", "string(//method_code)", "//Item[method_code]", "//Item[contains(method_code,'var')]", "//Item[@action='add']/name",
  "//Item[@action='add' and @type='List']/Relationships/Item", "//Relationships/Item[source_id='RT1']", "//Item[Relationships]", "count(*)=0",
  "count(//Item/*)", "//*[@is_null]", "//*[@is_null='1' and name()!='b']", "//Item[position()=last()]/@id", "//Item[not(@action)]/@id",
  "string-length(//name)", "concat(//name[1],'-',//name[2])", "substring(//name,1,1)", "normalize-space('  a   b ')", "translate('abc','abc','xyz')",
  "sum(//n)", "boolean(//Item)", "true()", "false()", "1+2", "10 div 4", "10 mod 3", "-1", "1 = 1.0", "'a' < 'b'", "'b' < 'a'", "2 > 1", "1 and 0", "1 or 0",
);
xps(
  MANDOC,
  "imports/package", "imports/package[@name='com.aras.innovator.core']", "imports/package[@name='com.aras.innovator.core']/@path",
  "imports/package[@name='com.aras.innovator.solution.PLM']/dependson", "imports/package/dependson[@name='com.aras.innovator.core']",
  "imports/package[dependson/@name='com.aras.innovator.core']/@name", "imports/package[starts-with(@name,'com.aras.innovator.sol')]",
  "imports/package/dependson/referenced_element[@id='ABC']", "imports/package/dependson/referenced_element/@descr", "//package[not(dependson)]/@name",
  "count(imports/package)", "imports/package[2]", "imports/package[last()]/@name", "imports/package[@name='com.aras.innovator.solution.PLM']/dependson[last()]",
  "imports/package[@name='O'Brien']", "imports/package[@name=\"O'Brien\"]", "imports/package[@name='a'b']", "imports/package[@name='x",
);
xps(
  MIXDOC,
  "//s[text()='RT1']", "//s[.='RT1']", "count(//s/text())", "//s/text()", "//s[string()='RT1']", "string(//s[3])", "//e[not(text())]", "//e[text()]",
  "//e[normalize-space(.)='']", "//n[. > 0]", "//n[number(.) = number(.)]", "number(//n[1])", "number(//n[2])", "number(//n[3])", "number('  12 ')", "number('1e3')",
  "number('-.5')", "number('+5')", "number('')", "number('0x10')", "number('1.')", "number('.5.')", "string(0.1 + 0.2)", "string(1 div 0)", "string(-1 div 0)", "string(0 div 0)",
  "string(-0)", "string(1e3)", "string(1000000000000000000000)", "string(0.000001)", "string(123456789012345678)", "string(100)", "string(1.0)", "string(0.5)", "string(-0.5)",
  "string(3.14159)", "round(2.5)", "round(-2.5)", "round(0.4)", "floor(-1.5)", "ceiling(1.2)", "substring('12345', 1.5, 2.6)", "substring('12345', 0, 3)",
  "substring('12345', 2)", "substring('12345', -1)", "substring-before('a=b','=')", "substring-after('a=b','=')", "normalize-space('  a \t b\n ')",
  "string-length('\ud83d\ude00\u00e9')", "substring('\ud83d\ude00\u00e9',2,1)", "//nothing != ''", "not(//nothing = '')", "id('A1')", "foo()", "x:Item", "//Item[",
  "//Item[@type='Property' and data_source!=]", "//Item[.='x' or]", "//s[1] = //s[2]", "//s != //e", "count(//s[. = 'RT1'])", "lang('en')", "//t", "string(//t)",
  "normalize-space(//t)", "string-length(//t)", "contains(//t,'a  b')", "translate(//t,' ','_')", "//*[name()='n']", "//*[local-name()='n'][2]",
  "@*", "*", "//r/*[2]", "//r/*[position()=2 or position()=3]", "//r/s[last()]", "//r/*[last()-1]", "name(//r/*[1])", "name(//@*)", "count(//@*)",
);

// the lookups of MAN-014: a package, dependency or element name between single quotes, unescaped
{
  const names = [
    "'", "a'", "'a", "a''b", "a'b", "a'b'c", "x')", "x'[1]", "a' and 'b", "x' or @name='My.Pkg", "x' or ''='", "x' or 1=1 or '",
    "x'] | //package[@name='My.Pkg", 'a"b', "a]b", "a&b", "a<b", "", " ", "a b", "x'[", "x' or", "x'|", "x'/", "x'()", "x'+", "x'=", "x'!", "x'!='",
    "x' and", "x' div", "x'[@a]", "x'/b", "x'//b", "x'*", "x' *", "x'.", "x'..", "x'@", "x'$", "x'$a", "x'::", "x'a::b", "x'text()", "x'node()",
    "x'(", "x')", "x',", "x'-", "x'-1", "x'<", "x'<=", "x'>", "x'1", "x'1.5", "x'.5", "x'a:b", "x'a:*", "x'#", "x'{", "x'~", "x'^", "x'%", "x'\\",
  ];
  const shapes = [
    (n) => `imports/package[@name='${n}']`,
    (n) => `dependson[@name='${n}']`,
    (n) => `referenced_element[@id='${n}']`,
    (n) => `//Item[@type='PackageDefinition' and name='${n}']`,
  ];
  names.forEach((n, i) => shapes.forEach((shape, k) => xp(`name${String(i + 1).padStart(2, "0")}-${k + 1}`, MANDOC, shape(n))));
}
// other expressions that do not parse
xps(
  MANDOC,
  "", " ", "/", "//", "/imports", "(", ")", "()", "(1", "1)", "1 +", "+1", "- -1", "a b", "a,b", "a(", "a(b", "a(b,", "a(b,)", "count(", "count(,)", "string(1,2)",
  "//", "///a", "a//", "a/", "/ /a", "a[]", "a[1", "a[1]]", "a]", "[1]", "(a)[1]", "(1)[1]", "'a'[1]", "'a'/b", "1/b", "(1)/b", "a|", "|a", "a||b", "1|2", "a|1",
  "@", "@@a", "@*", "@a:b", "a::b", "child::a", "child::*", "child::", "::a", "bogus::a", "parent::node()", "self::node()", "node()", "text()", "comment()",
  "processing-instruction()", "processing-instruction('x')", "processing-instruction(x)", "node(", "node(1)", "text(a)", "*", "*/*", "* *", "a * b", "a div b", "a mod b",
  "div", "mod", "and", "or", "div div div", "a and", "and a", "a or or b", "a = = b", "a != b", "a ! b", "a <> b", "a <= b", "a >= b", "a < b", "a > b", "a = 'x' = 'y'",
  "$a", "$", "$1", "$a:b", "1e3", "1.5.5", ".5", "5.", "..", "...", ". .", "./a", "../a", ".//a", "a/.", "a/..", "a/./b", "a/../b", "a:*", "*:a", "a:b:c", "a:",
  ":a", "a b c", "'", '"', "'a", '"a', "'a'b", "'a' 'b'", "'a'+1", "1'a'", "a'", "a'b'", "#", "a#", "a{b}", "a~", "a^", "a%", "a&b", "a\\b", "a;b", "a?b",
);

xp("ns-bound", SOAPDOC, "//@xml:lang");
xp("ns-unbound-plain", SOAPDOC, "//Item", { ns: false });
xp("preserve-false", "<r>\n <a> </a>\n <b>x</b>\n</r>", "//text()", { preserve: false });
xp("preserve-true", "<r>\n <a> </a>\n <b>x</b>\n</r>", "//text()", { preserve: true });
xp("order-union", AMLDOC, "//name | //Item | //method_code");
xp("order-union-attr", AMLDOC, "//Item/@id | //Item/@type | //Item");
xp("order-reverse-axis", AMLDOC, "//name/ancestor::*");
xp("order-following", AMLDOC, "//name/following::*");
xp("order-preceding", AMLDOC, "//source_id/preceding::*");
xp("order-desc-or-self", AMLDOC, "/descendant-or-self::node()[self::Item or self::name]");

// more loading
wf("fx01", "&amp;<a/>");
wf("fx02", "<a/>&");
wf("fx03", "<a/><b");
wf("fx04", "<a/><!-");
wf("fx05", "<a/>\n<!-");
wf("fx06", '<a b="1"');
wf("fx07", "<a ");
wf("fx08", "<a b='1' ");
wf("fx09", "<a b='1'/");
wf("fx10", "<a><b/>");
wf("fx11", "<a></");
wf("fx12", "<a></a");
wf("fx13", "<a></a ");
wf("fx14", '<a xml:space="bogus"/>');
wf("fx15", '<a xml:space="preserve" xml:space="default"/>');
wf("fx16", "<a>&#99999999999;</a>");
wf("fx17", "<a>&#xFFFFFFFF;</a>");
wf("fx18", "<a>&#x10FFFF;&#x10000;&#x1F600;</a>");
wf("fx19", "<a>&#xD800;&#xDC00;</a>");
wf("fx20", "<a b='&#xD800;&#xDC00;'/>");
wf("fx21", "<a>&#x20;</a>", false);
wf("fx22", "<a>&#32;</a>", false);
wf("fx23", "<a>&#x9;&#x20;</a>", false);
wf("fx24", "<a><?pi?></a>");
wf("fx25", "<a><?pi ?></a>");
wf("fx26", "<a><?pi  data  ?></a>");
wf("fx27", "<a><?pi?x?></a>");
wf("fx28", "<a><?p:i x?></a>");
wf("fx29", "<a><!-- ? --><!--<b/>--></a>");
wf("fx30", "<a><![CDATA[<![CDATA[x]]></a>");
wf("fx31", "<?xml version='1.0' encoding='UTF-8' standalone='no'?><a/>");
wf("fx32", '<?xml version="1.0" encoding="utf-8"?>\r\n<!--c-->\r\n<a/>');
wf("fx33", '<?xml version="1.0" standalone="maybe"?><a/>');
wf("fx34", '<?xml version="1.0" encoding=""?><a/>');
wf("fx35", '<?xml version=""?><a/>');
wf("fx36", '<?xml version = "1.0" ?><a/>');
wf("fx37", "<a xmlns:p='u' xmlns:p='v'/>");
wf("fx38", "<a xmlns='u' xmlns='v'/>");
wf("fx39", "<p:a xmlns:p='u' p:x='1' x='2'/>");
wf("fx40", "<a xmlns:p='u'><b xmlns:p='v'><p:c/></b><p:d/></a>");
wf("fx41", "<a xmlns='u'><b/><c xmlns=''><d/></c></a>");
wf("fx42", "<a xmlns:p='http://www.w3.org/2000/xmlns/'/>");
wf("fx43", "<a xmlns='http://www.w3.org/2000/xmlns/'/>");
wf("fx44", "<xmlns:a xmlns:xmlns='u'/>");
wf("fx45", "<a xml:id='x'/>");
wf("fx46", "<xml:a/>");
wf("fx47", "<a><b/ ></a>");
wf("fx48", "<a><b></ b></a>");
wf("fx49", "<a><b></b ></a>");
wf("fx50", "<a><b></b\n></a>");
wf("fx51", "<a></a\u00a0>");
wf("fx52", "<a></a x>");
wf("fx53", "<a b='1'></a>\r\n");
wf("fx54", "<a>\u00e9\u20ac\ud83d\ude00</a>");
wf("fx55", "<\u00e9\u20ac/>");
wf("fx56", "<a \u00e9='1'/>");
wf("fx57", "<a a\u0301='1'/>");
wf("fx58", "<a>]]></a>", false);
wf("fx59", "<!DOCTYPE a><!--c--><a/>");
wf("fx60", "<!--c--><!DOCTYPE a><a/>");
wf("fx61", "<!DOCTYPE a ><a/>");
wf("fx62", "<!DOCTYPE  a><a/>");
wf("fx63", "<!DOCTYPE\ta\n><a/>");
wf("fx64", "<!DOCTYPE a><b/>");
wf("fx65", "<!DOCTYPE a[]><a/>");
wf("fx66", "<!DOCTYPE a []><a/>");
wf("fx67", "<!DOCTYPE a:b><a/>");
wf("fx68", "<!DOCTYPE 1><a/>");
wf("fx69", "<a><b>x</b>\r\n  <c/></a>", false);
wf("fx70", "<a>x<b/>\n</a>", true);
// a character reference to white space, with white space dropped (decimal and hexadecimal references differ)
[
  "<a>&#x20;&#32;</a>", "<a>&#32;&#x20;</a>", "<a>&#xA;</a>", "<a>&#xD;</a>", "<a>&#x9;</a>", "<a> &#x20; </a>", "<a>&#x20;<b/></a>", "<a>&#x20;x</a>",
  "<a>&#x20;&amp;</a>", "<a>&amp;</a>", "<a>&#10;&#x20;</a>", "<a>&#x0020;</a>", "<a>&#x20;&#x20;</a>", "<a><b/>&#x20;</a>", "<a><b>&#x20;</b></a>",
  '<a xml:space="preserve">&#x20;</a>', "<a>&#x20;<![CDATA[x]]></a>", "<a>&#32;<![CDATA[x]]></a>",
].forEach((t, i) => wf(`fy${String(i + 1).padStart(2, "0")}`, t, false));
wf("fx71", "<a xmlns:p='http://www.w3.org/XML/1998/namespace'/>");
wf("fx72", "<a xmlns:xml='http://www.w3.org/XML/1998/namespace'/>");
wf("fx73", "<a xmlns='http://www.w3.org/XML/1998/namespace'/>");


// the DAC condition writer of EXP-119: an XmlWriter on a fragment (ConformanceLevel.Auto), indent of one space
[
  '<condition><and><eq><property name="a"/><constant>x &amp; y é </constant></eq></and></condition>',
  "<condition>\r\n  <eq a='q\"' /><!--c--></condition>",
  "", "<a/><b/>", '<?xml version="1.0"?><a/>', "<![CDATA[<c><d/></c>]]>", "<c>&nbsp;</c>", "<c>&amp;nbsp;</c>", "text", "text<a/>", "<a/>text", "  <a/>  ",
  "<a>x</a><b>y</b>", "<a><b/></a>\n<c/>", "<a b='1' c=\"2\"/><!--x--><?pi d?>", "<a>\r\nb\rc\nd</a>", "<a><![CDATA[x\r\ny]]></a>", "<a xmlns:p='u'><p:b/></a>",
  "<p:a/>", "<a>&lt;&gt;&amp;&quot;&apos;</a>", "<a b='&lt;&gt;&amp;&quot;&apos;&#9;&#10;'/>", "<a/><a/><a/>", "<a>1</a>2<b/>3", "<!--only-->", "<?pi only?>",
  "<a>é  </a>", "<a><b>x</b>  <c/></a>", "<a>\t<b/>\t</a>", "&unknown;", "a &amp; b",
].forEach((t, i) => add(`fw.${String(i + 1).padStart(2, "0")}`, "fragment-write", { text: t }));
// InnerXml and InnerText of an element (CdataFilterXml, EXP-405)
const ix = (id, text, path, preserve = true) => add(`in.${id}`, "inner-xml", { text, path, preserve });
ix("01", "<a><condition_xml><![CDATA[<filter_xml>a&b</filter_xml>]]></condition_xml></a>", "/a/condition_xml");
ix("02", "<a><condition_xml>&lt;filter_xml&gt;&lt;a x=\"1\"&gt;t&amp;amp;u&lt;/a&gt;&lt;/filter_xml&gt;</condition_xml></a>", "/a/condition_xml");
ix("03", "<a><condition_xml><filter_xml><![CDATA[x]]></filter_xml></condition_xml></a>", "/a/condition_xml");
ix("04", "<a><c/></a>", "/a/c");
ix("05", "<a><c></c></a>", "/a/c");
ix("06", "<a><c>x</c></a>", "/a/c");
ix("07", "<a><c><d/>t<e>u</e><!--c--><?pi x?></c></a>", "/a/c");
ix("08", "<a><c>\r\nx\ry\nz</c></a>", "/a/c");
ix("09", "<a><c><![CDATA[a]]]]><![CDATA[>b]]></c></a>", "/a/c");
ix("10", '<a><c><d x="1&#10;2&#9;3&#13;4" y="&lt;&amp;&quot;"/></c></a>', "/a/c");
ix("11", "<a><c>&amp;&lt;&gt;&quot;&apos;</c></a>", "/a/c");
ix("12", "<a><c>é  😀</c></a>", "/a/c");
ix("13", '<a xmlns:p="u"><p:c><p:d/><e/></p:c></a>', "/a/*[local-name()='c']");
ix("14", '<a xmlns:p="u"><c><p:d p:x="1"/></c></a>', "/a/c");
ix("15", '<a xmlns="u"><c><d/></c></a>', "/*/*");
ix("16", "<a><c>  <d/>  </c></a>", "/a/c");
ix("17", "<a><c>  <d/>  </c></a>", "/a/c", false);
ix("18", "<a><c>&#1;&#xFFFE;</c></a>", "/a/c");
ix("19", "<a><c>x&#xD800;y</c></a>", "/a/c");
ix("20", "<a><c><d/></c><e/></a>", "/a");
ix("21", "<a><c>t</c><!--c--><d/></a>", "/a");

// document edits (XmlDocument API) followed by the item-file writer: EXP-427
const ops = (id, text, list, preserve = true) => add(`op.${id}`, "ops", { text, preserve, ops: list });
const P = "/AML/Item/p";
ops("01", '<AML><Item><p/></Item></AML>', [{ op: "innerText", path: P, value: "" }]);
ops("02", '<AML><Item><p>x</p></Item></AML>', [{ op: "innerText", path: P, value: "" }]);
ops("03", '<AML><Item><p>x</p></Item></AML>', [{ op: "innerText", path: P, value: "y" }]);
ops("04", '<AML><Item><p/></Item></AML>', [{ op: "innerText", path: P, value: "y" }]);
ops("05", '<AML><Item><p><q/>t</p></Item></AML>', [{ op: "innerText", path: P, value: "y" }]);
ops("06", '<AML><Item/></AML>', [{ op: "append", path: "/AML/Item", name: "created" }]);
ops("07", '<AML><Item/></AML>', [{ op: "append", path: "/AML/Item", name: "created" }, { op: "innerText", path: "/AML/Item/created", value: "" }]);
ops("08", '<AML><Item/></AML>', [{ op: "append", path: "/AML/Item", name: "created" }, { op: "setIsEmpty", path: "/AML/Item/created", value: false }]);
ops("09", '<AML><Item/></AML>', [{ op: "append", path: "/AML/Item", name: "created" }, { op: "innerXml", path: "/AML/Item/created", value: "" }]);
ops("10", '<AML><Item><p/></Item></AML>', [{ op: "innerXml", path: P, value: "" }]);
ops("11", '<AML><Item><p>x</p></Item></AML>', [{ op: "innerXml", path: P, value: "" }]);
ops("12", '<AML><Item><p>x</p></Item></AML>', [{ op: "removeAll", path: P }]);
ops("13", '<AML><Item><p></p></Item></AML>', [{ op: "removeAll", path: P }]);
ops("14", '<AML><Item><p/></Item></AML>', [{ op: "removeAll", path: P }]);
ops("15", '<AML><Item><p a="1">x</p></Item></AML>', [{ op: "removeAll", path: P }]);
ops("16", '<AML><Item><p a="1" xmlns:q="u" q:b="2"/></Item></AML>', [{ op: "removeAll", path: P }]);
ops("17", '<AML><Item><Relationships><Item type="b"/></Relationships></Item></AML>', [{ op: "removeNode", path: "/AML/Item/Relationships/Item" }]);
ops("18", '<AML><Item><p/></Item></AML>', [{ op: "appendText", path: P, value: "x" }, { op: "removeNode", path: "/AML/Item/p/text()" }]);
ops("19", '<AML><Item><p/></Item></AML>', [{ op: "appendText", path: P, value: "a\rb\r\nc\nd" }]);
ops("20", '<AML><Item><p/></Item></AML>', [{ op: "setAttr", path: P, name: "v", value: "a\rb\r\nc\nd\te<f>g&h\"i'j" }]);
ops("21", '<AML><Item><p/></Item></AML>', [{ op: "appendCData", path: P, value: "a]]>b\rc\r\nd\ne" }]);
ops("22", '<AML><Item><p/></Item></AML>', [{ op: "appendCData", path: P, value: "" }]);
ops("23", '<AML><Item><p/></Item></AML>', [{ op: "appendComment", path: P, value: " c " }]);
ops("24", '<AML><Item><p/></Item></AML>', [{ op: "appendText", path: P, value: "  " }]);
ops("25", '<AML><Item><p/></Item></AML>', [{ op: "setAttr", path: P, name: "a", value: "1" }, { op: "removeAttr", path: P, name: "a" }]);
ops("26", '<AML><Item><p/></Item></AML>', [{ op: "append", path: P, name: "q" }]);
ops("27", '<AML><Item><p/></Item></AML>', [{ op: "append", path: "/AML/Item", name: "q" }, { op: "append", path: "/AML/Item/q", name: "r" }]);
// InnerXml with a fragment
const frag = (id, value, text = '<AML><Item><p/></Item></AML>', preserve = true) => ops(`ix${id}`, text, [{ op: "innerXml", path: P, value }], preserve);
frag("01", "<b/>text<!--c-->");
frag("02", "&lt;b/&gt;");
frag("03", "<![CDATA[x<y]]>");
frag("04", "  ");
frag("05", "  ", '<AML><Item><p/></Item></AML>', false);
frag("06", "<a/>  <b/>", '<AML><Item><p/></Item></AML>', false);
frag("07", "<q:a/>", '<AML xmlns:q="u"><Item><p/></Item></AML>');
frag("08", "<q:a/>");
frag("09", "<a xmlns:q='v'><q:b/></a>", '<AML xmlns:q="u"><Item><p/></Item></AML>');
frag("10", '<?xml version="1.0"?><a/>');
frag("11", "<a>");
frag("12", "</a>");
frag("13", "a &amp; b &foo; c");
frag("14", "a & b");
frag("15", "<a/><a/>");
frag("16", "x&#1;y");
frag("17", "<!DOCTYPE a>");
frag("18", "]]>");
frag("19", "a\r\nb");
frag("20", "<a b='1\r\n2'/>");
frag("21", "text", '<AML><Item><p xml:space="preserve"> </p></Item></AML>', false);
frag("22", " <b/> ", '<AML><Item><p xml:space="preserve"/></Item></AML>', false);
frag("23", "<b></b>");
frag("24", "<b/>");
frag("25", "<?pi data?>");
frag("26", "x<");
frag("27", "<a>&amp;</a>");
frag("28", "\u00e9&#233;");


export default cases;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(cases));
}
