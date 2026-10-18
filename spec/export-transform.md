# The export transform: root, Items, references, fix items and drops

Every exported item goes through one XSLT 1.0 stylesheet before it is written: `export.xsl`, an embedded resource of `Libs.dll`. This document re-expresses it as rules, in the order a reader needs them: the model first (loading, template selection, defaults, empty text, namespaces), then the root wrapper, then each family of templates. The TypeScript port implements these rules as code, not as XSLT (round 1, Q2; wayfinder tickets 31 and 32).

The document has two halves. **Part 1** (`EXP-200` to `EXP-272`) covers the root wrapper, Items, Identities, Methods, the dropped Items and the reference rewrites. **Part 2** (`EXP-300` to `EXP-399`, from "Part 2: the model" on) covers the rest of the stylesheet: the system-element and Property drops, the Variable and User drops, the `mode="fix"` follow-up items that the root template appends (the ItemType edit that carries keyed and modified system properties, the View/Form delete items, the Field fixes, Members and Morphae re-emitted at the end) and the `xsl:output` CDATA element list. Where a part 1 rule hands over to part 2, it says so. The SOAP-ENV string strip and the reload of the result belong to the post-processing document (`EXP-400` to `EXP-499`, ticket 15).

Sources:

- the 14.0.7 decompile of `Libs.dll` (`.decomp/14.0.7/`, never committed): `CItemHelper::ApplyXsl`, `GetXslTransform` and `GetManifestResourceStream`, and the stylesheet resource `Aras.Tools.SolutionUpgrade.export.xsl` that ILSpy extracts next to the project. Rules cite the stylesheet by template, not by quoting it, and give its line numbers as `export.xsl:N`.
- probes of that stylesheet, run under `XslCompiledTransform` on Windows PowerShell 5.1 with the same loading and invocation as `ApplyXsl` (EXP-200, EXP-201), on hand-written response documents. The worked examples below are reduced from those runs and show the transform's raw output. Part 2 rests on over a thousand such cases, among them a sweep of every cell of the system-property comparison table (EXP-323: each of the 11 compared fields of each of the 32 system properties, changed and removed). Wayfinder ticket 68 turns such probes into recorded fixtures, and tickets 31 and 32 replay them: `fixtures/14.0.7/xsl/export/` and `fixtures/14.0.7/xsl/export-items/` (inputs in `oracle/xsl-cases/`), whose cases ticket 31 compares byte for byte with the part 1 transform. `export-items` holds the ticket 13 probes and the cases that fixed the rules below where the first reading was loose: the root wrapper at any depth (`w`), namespaces (`n`), the lookups of the reference rewrites (`q`), Identity and Method forms (`s`), dropped Items and the reference chain (`t`) and text (`x`).
- `data/libsjs-06/report.md` (rules X1 to X7 for `XslCompiledTransform`) and `data/libsjs-08/report.md` (finding F6, the empty-text correction to X6).
- for 14.35: the stylesheet resource of the 14.35 decompile (`.decomp/14.35/`, never committed), compared with 14.0.7's line by line, and the same probes run against the 14.35 `Libs.dll` (`oracle/export-output-probe/probe.ps1`, sections `AX`, `AXF` and `RNN`, recorded in `fixtures/export-output/probe-14.35.txt` with the 14.0.7 run beside it in `probe-14.0.7.txt`).

**Engine 14.35.** The 14.35 stylesheet is 14.0.7's with two changes, and nothing else: the comparisons of the modified system Properties gain one alternative (EXP-381), and one template is added (EXP-380). Every rule of this document therefore holds for 14.35 as written, unless the rule has a `[14.35]` variant. Line numbers cited as `export.xsl:N` are 14.0.7's; in 14.35 every line from 454 on is one higher.

The `[12.0]` variants come from the 12.0 stylesheet (`.decomp/12.0/`), compared with 14.0.7's line by line: it differs in exactly three places (EXP-315, EXP-324, EXP-360, and the line mapping in EXP-200). Every other rule says `Same as 14.0.7.`; the worked examples and the 14.0.7 probes of the stylesheet hold for 12.0 outside those places, since the template text is identical.

## Conventions

- **Source tree** is the response DOM that `ApplyXsl` receives: the SOAP envelope with the server's `Result`, after the pre-transform rewrites of `EXP-100` to `EXP-199`. It is loaded with `PreserveWhitespace = true`, so whitespace-only text nodes are real nodes.
- **Output** is the text the transform writes. The examples show it before the post-processing steps, one line, with line breaks only where the source had text line breaks.
- An **Item** is an element named `Item`, matched by its `type` attribute. A **property** is any other child element of an Item. A **root Item** is an `Item` that is a child of `Result`; any other Item is **nested**.
- `string-value` means the XPath 1.0 string value: for an element, the concatenation of all its descendant text, in document order, without comments, processing instructions or attributes. A node-set used as a string is its first node in document order. `a = b` between node-sets is true when some pair of nodes has equal string values.
- Element and attribute names, and the type names such as `Identity`, are compared exactly (case-sensitive, no trimming).

## The model

### EXP-200: The stylesheet and how it is loaded

[14.0.7] The stylesheet is the resource `Aras.Tools.SolutionUpgrade.export.xsl`, version 1.0, with no `msxsl`, script or extension function. `CItemHelper.ApplyXsl(doc, "export.xsl")` reaches it through `GetXslTransform`, which reads the resource with an `XmlTextReader`, compiles it with `XslCompiledTransform.Load`, and caches the compiled transform in a static dictionary under the resource name, so each process compiles it once. `GetXslTransform` runs inside `ApplyXsl`'s handler (EXP-201), so a missing resource (a `CItemException` from `GetManifestResourceStream` with the "not compiled or does not exist" message) and a stylesheet that does not compile are both wrapped like a run-time failure. Neither can happen with the shipped `Libs.dll`.

The library reads the stylesheet from the vendored `Libs.dll` only at oracle time. The port never embeds or interprets it.

[12.0] Loaded the same way. The stylesheet is the 12.0 build's own resource, which has 453 lines and differs from 14.0.7's in three places: the `cdata-section-elements` list (EXP-360), a template for `User/pwd_is_set_on` that does not exist (EXP-315), and the Change Controlled Relationship arm of the Property fix (EXP-324). A line number `export.xsl:N` in this document is a line of 14.0.7's stylesheet. In 12.0's it is line N up to 101, N−2 for 104 to 408 (the template for `User/pwd_is_set_on` is 14.0.7's lines 102 and 103), N−3 for 410 to 412 and N−7 from 417 (14.0.7's lines 409 and 413 to 416 are the added variable and arm). The rest of the stylesheet is identical, and so is `ApplyXsl`.

[14.35] The same resource name, compiled the same way. The cache is a `ConcurrentDictionary` filled with `GetOrAdd`, so two items that reach it together may both compile the stylesheet and one result is kept. This is not observable. The stylesheet itself is the 14.35 build's own resource, which differs from 14.0.7's as the introduction says.

### EXP-201: Input and output of the transform

[14.0.7] `ApplyXsl` transforms the whole document (its document node, not an element) into a `StringWriter` with `InvariantCulture`, then removes the SOAP-ENV declaration string from the text and reloads the text into the same `XmlDocument` with `LoadXml` (post-processing, `EXP-400` to `EXP-499`).

- An exception raised while loading or running the transform is wrapped in a `CItemException` with faultcode `-1`, the original message followed by ` Error of  applying export.xsl.` (the message has two spaces), and the original exception as its cause.
- The reload is outside that handler. An `XmlException` from it (an empty output, several root elements, `]]>` in character data) propagates to `CExportItems.Export`, which turns it into a `CItemException` whose message is the exception's message followed by ` Can't export item.` The item then fails as a whole (`EXP-500` to `EXP-599`).
- The output method is `xml` with no declaration and no indentation. The text writer, the escaping of text and attributes, the `\r\n` line breaks and the `cdata-section-elements` list are ticket 06's rules X4 and X6; the list itself is part 2.

[12.0] Same as 14.0.7.

### EXP-202: Template selection

[14.0.7] A node is handled by the matching template of highest priority. The stylesheet declares no priorities, so the XSLT 1.0 defaults apply: a pattern that is a single bare name (`Item`, `Result`, `id`) has priority 0; `*` has -0.5; any pattern with a predicate or more than one step has 0.5. When two templates of the same priority match, `XslCompiledTransform` silently takes the one that comes last in the stylesheet (ticket 06, X3).

In default mode the stylesheet has, for elements:

| Priority | Templates |
|---|---|
| 0.5 | every template whose pattern has a predicate or a path: the Envelope, Body, Identity, Method, Member/Morphae, Item Action, RelationshipType, related_id, Field `propertytype_id`, Grid Event `source_id`, FileSelectorTemplate `reference`, foreign-property, Method-valued, Identity-valued and (part 2) Property, Variable, `behavior`, `css`, `item_behavior`, `pwd_is_set_on` and `Relationships` templates |
| 0 | the plain `Item` template, `Result`, and the bare element-name templates of the drop list (part 2) |
| -0.5 | the catch-all `*` template, which copies an element |

So a specific template always beats the plain `Item` template and the catch-all, by priority and not by order. No two templates of different behaviour tie in 14.0.7 (EXP-260). The root Item is not matched in default mode at all: the `mode="first"` template handles it (EXP-212).

[12.0] Same as 14.0.7.

[14.35] One more template is in default mode, with priority 0.5 (it has predicates): the `is_null` drop of EXP-380, which is the last template of the stylesheet but one (`export.xsl:454`, only `*` follows it). It matches elements only. The table above is otherwise unchanged. Because it comes after every other 0.5 template, it wins every tie at 0.5 (EXP-260).

### EXP-203: Nodes no template handles

[14.0.7] Nodes that no explicit template matches follow the XSLT built-in rules, and `apply-templates` without a `select` visits every child node:

- a **text node** is copied, including whitespace-only text (the source tree keeps it, EXP-201), so source indentation reaches the output;
- a **CDATA section** is only text to the transform; it is written as CDATA again only inside an element of the `cdata-section-elements` list (part 2), and otherwise as escaped text;
- a **comment** or **processing instruction** is dropped;
- **attributes** are never visited. They reach the output only through an explicit copy (EXP-212, EXP-220, EXP-221).

```xml
<!-- source -->  <Item type="A" id="1"><!-- c --><?pi data?><name><![CDATA[a<b>&c]]></name><x><!-- c2 --></x></Item>
<!-- output -->  <AML><Item type="A" id="1" action="add"><name>a&lt;b&gt;&amp;c</name><x /></Item></AML>
```

[12.0] Same as 14.0.7.

### EXP-204: "Empty text emitted" versus "no content"

[14.0.7] An output element is written `<x></x>` when the transform wrote a text node into it, even an empty one, and `<x />` when it received no text node and no child. Ticket 08 (finding F6) corrected ticket 06's X6 this way, and the reloaded document keeps the form (ticket 06, W3).

What writes a text node, even when its value is empty:

- `value-of` always does. So each of these gives `<x></x>` when its value is empty: the `name` of a Method reference, the `keyed_name`, `source_id` and `name` of a foreign-property or Grid Event reference, the Identity content of an Identity-valued property, the id that replaces a nested ItemType under `related_id`, and the id kept inside `propertytype_id`.
- A nested Identity Item that is not a system identity writes its id as text (EXP-230). When that id is empty, its container still receives a text node.
- Copying a zero-length text node. The source tree keeps a CDATA section with no characters as a text node of length 0, and the built-in text rule copies it: `<d><![CDATA[]]></d>` gives `<d></d>`, two such sections in a row too. The same holds in an element of the `cdata-section-elements` list (EXP-360), which then holds an empty CDATA section.

What writes none: copying an element whose source element is empty (`<x/>` and `<x></x>` both give `<x />`), copying attributes, and any element whose children were all dropped or produced no text.

```xml
<!-- source -->  <Item type="Foo" id="1"><a><Item type="Identity"><keyed_name>Acme</keyed_name></Item></a><b><Item type="Member" id="M"/></b><c></c></Item>
<!-- output -->  <AML><Item type="Foo" id="1" action="add"><a></a><b /><c /></Item></AML>
```

The port models this with an explicit flag on a written element: "received text". The item file writer (`EXP-400` to `EXP-499`) then prints `<x></x>` for a childless element with the flag and `<x />` without.

[12.0] Same as 14.0.7.

### EXP-205: Namespace declarations on copied elements

[14.0.7] `xsl:copy` copies, with the element, every namespace in scope for its source element (ticket 06, X1), the `xml` prefix excepted. Those bindings are the declarations of its source ancestors and of the element itself, outermost element first and in attribute order within one element. A prefix that an inner element declares again takes the position of the inner declaration, and an inner `xmlns=""` removes the default namespace. An output element created by `xsl:copy` carries a declaration (`xmlns:p="…"`, or `xmlns="…"` for the default namespace) for each of those bindings that is not already in force in the output at that point, after its attributes. What is in force depends on the output ancestors only: a binding that an ancestor declared with the same URI is not repeated, a prefix that is bound to another URI is declared again, and when the element that rebound it is closed the earlier binding is in force again for its following siblings. Elements written as literal result elements (`AML`, the generated `get` Items, the View/Form delete items) carry none of their own. An element in no namespace, copied or literal, whose output ancestors have a default namespace in force carries `xmlns=""`, after the other declarations.

In part 1 every copied element sits below the root Item copy, so:

- the root Item carries `xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"` (the Envelope's declaration) first, then the other bindings in scope for it, in the order above;
- a nested copied element carries a declaration only for a binding that the source declares on or below it and that no output ancestor has;
- the property elements and Items the transform builds itself carry none.

`ApplyXsl` then deletes the exact text of the SOAP-ENV declaration (ticket 06, X2; `EXP-400` to `EXP-499`). Every other declaration survives into the reloaded document, until `RemoveNamespaceNodes` removes prefixed attributes from `Item` elements only. So a declaration on a nested non-Item element stays in the exported file.

```xml
<!-- source: Envelope declares SOAP-ENV; the root Item declares i18n; a nested Item declares foo; <n> declares bar -->
<!-- output -->  <AML><Item type="A" id="1" action="add" xmlns:SOAP-ENV="…" xmlns:i18n="http://www.aras.com/I18N"><label i18n:x="1" xml:lang="en">l</label><Relationships><Item type="B" id="2" action="add" xmlns:foo="urn:foo"><n xmlns:bar="urn:bar">v</n></Item></Relationships></Item></AML>
<!-- source: Envelope declares q and r; the root Item declares s and t; <x> declares u and v -->
<!-- output -->  <AML><Item … action="add" xmlns:SOAP-ENV="…" xmlns:q="urn:q" xmlns:r="urn:r" xmlns:s="urn:s" xmlns:t="urn:t"><Relationships><Item … action="add"><x xmlns:u="urn:u" xmlns:v="urn:v" /></Item></Relationships></Item></AML>
<!-- source: the root Item declares p as urn:1; <x> rebinds it to urn:2; the following <z> declares it as urn:1 again -->
<!-- output -->  <AML><Item … xmlns:p="urn:1"><x xmlns:p="urn:2"><y p:a="1" /></x><z /></Item></AML>
<!-- source: <Relationships xmlns="urn:d"> holds an Item with xmlns="" and type Method -->
<!-- output -->  <Relationships xmlns="urn:d"><Item type="Method" action="get" select="id" xmlns=""><name>n</name></Item></Relationships>
```

An Item in a default namespace (`<Item xmlns="urn:d">`) is not an `Item` for any template (EXP-210, EXP-220): a root Item like that is not found, and a nested one is copied as an ordinary element, with all its attributes and no `action`.

[12.0] Same as 14.0.7.

## The root wrapper

### EXP-210: Envelope, Body and Result

[14.0.7] The document node is handled by a template that visits only its `Envelope` children. An `Envelope` is any element whose local name is `Envelope`, whatever its namespace or prefix, and its template visits the `Body` children. A `Body` is any element whose local name is `Body`, likewise, and its template visits the `Result` children. `Result` is different: only a `Result` with no namespace is visited, and its template visits the `Item` children with no namespace. The root Items are those Items.

The three templates match their elements wherever they stand, not only at the top. An `Envelope`, a `Body` or a `Result` below the root Item (in the content of a property, say) is not copied: its template runs there, and the `Item` children of a `Result` in it are written as `<AML>` wrappers inside the surrounding output element (`<Item …><Envelope><Body><Result><Item type="B" id="2"/></Result></Body></Envelope></Item>` gives `<Item …><AML><Item type="B" id="2" action="add" /></AML></Item>`). A nested `Body` with no `Envelope` around it does the same. Everything else in those elements, text and other children included, is dropped.

Any other shape writes nothing: a document whose root element is not an `Envelope`, a `Body` without a `Result`, a prefixed `Result` (`SOAP-ENV:Result`), or a `Result` without Item children. The empty output then fails the reload (EXP-201), and the item fails with `Root element is missing. Can't export item.`

[12.0] Same as 14.0.7.

### EXP-211: One AML wrapper per root Item

[14.0.7] Each root Item is written inside its own `<AML>` element, with the root Item copy first and the part 2 follow-up items after it (EXP-214). A response with two root Items therefore writes two `AML` elements in a row, and the reload fails with `There are multiple root elements.` Exports request one item by id, so a normal `Result` holds one Item.

[12.0] Same as 14.0.7.

### EXP-212: The root Item's attributes

[14.0.7] The root Item is copied (as an element, with the namespaces of EXP-205), and its attributes are rebuilt rather than copied:

1. `type`, copied from the source if present;
2. `id`, copied if present;
3. `action`, always set to `add`, whatever the source had (a response's `action="get"` is lost);
4. `dependencyLevel`, copied if present.

Every other attribute (`keyed_name`, `is_null`, `typeId`, anything) is dropped. The attributes keep that order, and an absent `type` or `id` is simply absent. Then the root Item's children are handled in default mode (EXP-203, EXP-220 and the rules below).

`dependencyLevel` is on the root only: ticket 12's rewrite puts it there for a RelationshipType (`EXP-100` to `EXP-199`). A nested Item loses its `dependencyLevel` (EXP-220).

```xml
<!-- source -->  <Item type="Method" id="M1" keyed_name="k" is_null="0" foo="bar" dependencyLevel="2" action="get" typeId="T"><name>m</name><comments/></Item>
<!-- output -->  <AML><Item type="Method" id="M1" action="add" dependencyLevel="2"><name>m</name><comments /></Item></AML>
```

[12.0] Same as 14.0.7.

[14.35] Same. The `is_null` drop (EXP-380) is a default-mode template and never applies to the root Item, whose `is_null` attribute is dropped here with every other attribute (probes `AX5`, `AX9`). The root's children are tested.

### EXP-213: The root Item is exempt from the nested-Item templates

[14.0.7] The templates for nested Items (EXP-220 and the Identity, Method, Member/Morphae, Item Action, RelationshipType and ItemType families below) are never applied to the root Item, because the root is handled by its own template and its children are visited, not the root itself. A root Identity, Method, Member, Morphae, Item Action or RelationshipType is therefore exported in full, as an ordinary item with `action="add"`.

The Identity and Method templates carry a second guard (EXP-230, EXP-235): they do not match an Item whose parent is an element named `Result`. That matters only for an Item below a nested element called `Result`. The `Result` template matches that element too (EXP-210), so such an Item is handled like a root Item: wrapped in its own `<AML>` with the root rules of EXP-212, inside the surrounding element. A response does not contain one.

Property-level templates still apply to the root's own children: a root `View` has its `role` and `method` rewritten (EXP-231, EXP-236), a root `Report` its `method`, a root `Field` its `propertytype_id` (EXP-252), and a root `Property` its foreign-property references and Grid Events (EXP-250, EXP-251, EXP-253).

[12.0] Same as 14.0.7.

### EXP-214: What follows the root Item in the AML

[14.0.7] After the root Item copy, the root template writes, in this order, the items that part 2 specifies. Each condition is evaluated on the source tree:

1. for a root `ItemType`, the ItemType edit item (the `mode="fix"` pass of the root Item); for a root `RelationshipType`, the same pass on its embedded `relationship_id/Item` of type `ItemType`;
2. the View and Form `delete` items, in two cases: the root is an `ItemType` with no `View` among its relationships, or the root has a `relationship_id` child holding an Item (a RelationshipType after ticket 12's rewrite) whose own relationships have no `View`; the two tests are independent, so both can fire;
3. the Field fix items: for every `Field` Item anywhere in the source tree below the document, each whose `propertytype_id` `keyed_name` is a system property name;
4. the Member fix items, one per `Member` Item among the root's relationships;
5. the Morphae fix items, one per `Morphae` Item among the root's relationships.

Members and Morphae are dropped from their place in the relationship list (EXP-240) so that these last two groups can add them after the Items they refer to.

[12.0] Same as 14.0.7.

## Items and elements

### EXP-220: A nested Item

[14.0.7] A nested Item that no more specific template takes (the plain `Item` template, priority 0) is copied with exactly three attributes, in this order: `type` and `id` if present, then `action="add"`. Every other attribute, including `keyed_name`, `is_null`, `dependencyLevel` and a source `action`, is dropped. Its children are handled in default mode.

```xml
<!-- source -->  <Relationships><Item type="B" id="2" action="get" keyed_name="kb" is_null="0" dependencyLevel="9" extra="x"><name>b</name></Item><Item id="3"><name>c</name></Item></Relationships>
<!-- output -->  <Relationships><Item type="B" id="2" action="add"><name>b</name></Item><Item id="3" action="add"><name>c</name></Item></Relationships>
```

[12.0] Same as 14.0.7.

[14.35] Same for every nested Item that is not marked `is_null="1"`. One that is marked is dropped with its subtree (EXP-380, probe `AX4`) and never reaches this template.

### EXP-221: Every other element

[14.0.7] An element no template matches (the catch-all `*`, priority -0.5) is copied with all its attributes, including `is_null`, `keyed_name`, `type`, `xml:lang` and prefixed attributes, and its children are handled in default mode. Part 2's drop templates beat this rule for the system elements and the empty `Relationships`.

[12.0] Same as 14.0.7.

[14.35] Same, except that an element with `is_null="1"` (and a name that does not start with `xp-`) is dropped (EXP-380) instead of being copied with its attribute. An `xp-*` element keeps `is_null="1"` as in 14.0.7.

## Identities

### EXP-230: A nested Identity Item

[14.0.7] A nested `Item` of type `Identity` (and not a child of an element named `Result`) is replaced, whatever its other children are:

- when the text of its `keyed_name` child is exactly one of `World`, `Creator`, `Owner`, `Manager`, `Innovator Admin`, `Super User`, by `<Item type="Identity" action="get" select="id"><name>NAME</name></Item>`, where NAME is that `keyed_name` text;
- otherwise by the bare text of its `id` attribute: no element, only a text node, which may be empty and then writes nothing visible (EXP-204).

The test is a substring test on the string `|keyed_name|` against `|World|Creator|Owner|Manager|Innovator Admin|Super User|` (EXP-271), so a `keyed_name` such as `World|Creator` also counts as a system identity. A missing, empty, differently cased or padded `keyed_name` (`world`, ` World `) does not. The `name` child is never read.

Where the Identity Item sits decides how the bare id looks: in a property such as `related_id` the id is that property's text, which is the intended use; in a `Relationships` element it becomes loose text next to the other items. The Item's children are not visited, so a Member nested in a non-system Identity is lost with it.

```xml
<!-- source -->  <Relationships><Item type="Identity" id="I1"><keyed_name>World</keyed_name></Item><Item type="Identity" id="I3"><keyed_name>Acme</keyed_name></Item><Item type="Identity" id="I4"><name>World</name></Item></Relationships>
<!-- output -->  <Relationships><Item type="Identity" action="get" select="id"><name>World</name></Item>I3I4</Relationships>
```

[12.0] Same as 14.0.7.

### EXP-231: Identity-valued properties

[14.0.7] Six property elements are rewritten the same way, whether their Item is nested or the root:

- `role` of a `View`;
- `escalate_to` of an `Activity Template`, and of an `Activity Template Assignment`;
- `alternate_identity` of an `Activity Template EMail`;
- `role` of a `Life Cycle Transition`;
- `process_owner` of a `Workflow Map`.

The element is copied with all its attributes. Its content is replaced by the Identity rule's result (EXP-230), computed from the element itself: `keyed_name` is the element's `keyed_name` attribute (empty when absent) and the id is the element's string-value. So a system identity gives the `get` Item as the element's child, and anything else (including an `is_null` element, or an Item already nested in it) gives the element's own text, which for an empty element writes `<role is_null="1"></role>` (EXP-204). The same property name on another Item type (`role` of an `Activity Template`) is not touched.

```xml
<!-- source -->  <Item type="View" id="V1"><role keyed_name="World" type="Identity">R1</role></Item><Item type="View" id="V2"><role keyed_name="Group" type="Identity">R2</role></Item>
<!-- output -->  <Item type="View" id="V1" action="add"><role keyed_name="World" type="Identity"><Item type="Identity" action="get" select="id"><name>World</name></Item></role></Item><Item type="View" id="V2" action="add"><role keyed_name="Group" type="Identity">R2</role></Item>
```

[12.0] Same as 14.0.7.

[14.35] Same, except that an Identity-valued property marked `is_null="1"` is dropped (EXP-380). The Identity Item nested in it, if any, goes with it (probes `AX6`, `AX16`: a marked `role` with the `keyed_name` `World`, which 14.0.7 rewrites to the system Identity `get`, is dropped). A property without `is_null="1"` is rewritten as before.

## Methods

### EXP-235: A nested Method Item

[14.0.7] A nested `Item` of type `Method` (and not a child of an element named `Result`) becomes `<Item type="Method" action="get" select="id"><name>NAME</name></Item>`, where NAME is the string-value of its first `name` child. Methods are versionable, so an import finds one by name. Nothing else of the Item is kept, not its code, attributes or relationships. A Method without a `name` gives `<name></name>`.

[12.0] Same as 14.0.7.

### EXP-236: Method-valued properties

[14.0.7] Seven property elements are rewritten the same way, nested or root:

- `method` of a `Report`, of an `Action` and of a `View`;
- `pre_action` and `post_action` of a `Life Cycle Transition`;
- `on_complete` of an `Action`;
- `content_generator` of a `tp_XmlSchemaElement`.

The element is copied with all its attributes, and its content is replaced by `<Item type="Method" action="get" select="id"><name>NAME</name></Item>`, where NAME is the element's `keyed_name` attribute (empty when absent, `<name></name>`). The element's own text and any Item inside it are discarded. The same name under another Item type (`method` of a `Life Cycle Transition`) is copied unchanged.

An element with no `keyed_name`, such as `<method is_null="1"/>`, still gets a `get` with an empty name (EXP-272).

```xml
<!-- source -->  <Item type="Report" id="R1"><method keyed_name="rm" type="Method">M1</method></Item><Item type="Report" id="R2"><method is_null="1"/></Item>
<!-- output -->  <Item type="Report" id="R1" action="add"><method keyed_name="rm" type="Method"><Item type="Method" action="get" select="id"><name>rm</name></Item></method></Item><Item type="Report" id="R2" action="add"><method is_null="1"><Item type="Method" action="get" select="id"><name></name></Item></method></Item>
```

[12.0] Same as 14.0.7.

[14.35] Same, except that a Method-valued property marked `is_null="1"` is dropped (EXP-380; probes `AX14`, `AX15`, `AX16`: a marked `method` is dropped whether or not it has a `keyed_name`). A null Method-valued property therefore no longer exports as a `get` with an empty name (EXP-272). One that has no `keyed_name` and no `is_null="1"` still does.

## Dropped Items

### EXP-240: Members and Morphae are dropped in place

[14.0.7] A nested `Item` of type `Member` or `Morphae` writes nothing where it stands. Part 2 re-emits each one at the end of the AML (EXP-214). A root Member or Morphae is exported normally (EXP-213).

[12.0] Same as 14.0.7.

### EXP-241: Item Actions for "SolutionConfig Export" are dropped

[14.0.7] A nested `Item` of type `Item Action` is dropped when it has a `related_id` child whose `keyed_name` attribute is exactly `SolutionConfig Export`. The test is on the attribute of any `related_id` child; an Item Action whose `related_id` holds an expanded Action Item without that attribute, or whose keyed name differs in case, is kept.

[12.0] Same as 14.0.7.

### EXP-242: RelationshipTypes are dropped from ItemType exports

[14.0.7] A nested `Item` of type `RelationshipType` is dropped when it is a child of the `Relationships` element of an `Item` of type `ItemType`. That ItemType can be the root or one nested anywhere, such as the one embedded in `relationship_id`. A RelationshipType anywhere else (under another type, or in a non-`Relationships` element) is copied as an Item (EXP-220). The ItemType export carries its relationships' types in another way (`EXP-100` to `EXP-199`).

[12.0] Same as 14.0.7.

### EXP-243: An ItemType under related_id collapses to its id

[14.0.7] An `Item` of type `ItemType` whose parent is an element named `related_id` is replaced by the text of its `id` attribute. Nothing else of the Item is kept. The `related_id` element itself is copied normally, with its attributes, so `<related_id keyed_name="Part" type="ItemType">` keeps the id as its text. Without an `id` the element is `<related_id></related_id>` (EXP-204); several ItemTypes in one `related_id` have their ids concatenated.

An ItemType in any other property (`source_id`, `relationship_id`) is not collapsed. The one embedded in a RelationshipType's `relationship_id` is exported in full, as a nested Item (EXP-220), together with its own follow-up items from part 2.

```xml
<!-- source -->  <Item type="Bar" id="B1"><related_id keyed_name="Part" type="ItemType"><Item type="ItemType" id="IT9" keyed_name="Part"><name>Part</name></Item></related_id></Item><Item type="Bar" id="B6"><source_id keyed_name="Part" type="ItemType"><Item type="ItemType" id="IT7"><name>Part</name></Item></source_id></Item>
<!-- output -->  <Item type="Bar" id="B1" action="add"><related_id keyed_name="Part" type="ItemType">IT9</related_id></Item><Item type="Bar" id="B6" action="add"><source_id keyed_name="Part" type="ItemType"><Item type="ItemType" id="IT7" action="add"><name>Part</name></Item></source_id></Item>
```

[12.0] Same as 14.0.7.

### EXP-244: Containers keep their place

[14.0.7] Dropping a nested Item removes only the Item. Its `Relationships` element stays, so a `Relationships` whose only children were dropped is written `<Relationships />`, and any whitespace-only text around the dropped Item stays. Part 2's rule that drops an empty `Relationships` tests the source (no element children, whitespace text allowed), not the output, so it never removes such a leftover. What `RemoveEmptyRelationships` does with it is specified by `EXP-400` to `EXP-499`.

[12.0] Same as 14.0.7.

## References

### EXP-250: The data source of a foreign property

[14.0.7] In an `Item` of type `Property` that has a `data_type` child equal to `foreign`, the `data_source` element is replaced by `<data_source><Item type="Property" action="get" select="id"><name>NAME</name><source_id>SRC</source_id></Item></data_source>`. The element's own attributes and text are dropped.

- The matching siblings are the `Item` children of type `Property` of the foreign property's parent (its `Relationships` element, or the `Result` for a root Property, which can then find itself) that have an `id` child whose string-value equals the string-value of some `data_source` child of the foreign property. The `id` is the element `id`, not the attribute, and the comparison is an exact string comparison of the whole string-value (` A ` is not `A`, and `<id><x>A</x></id>` is `A`). Of two `data_source` children of the foreign property, either can match.
- NAME is the string-value of the first `name` child in document order among all the matching siblings, so a first match without a `name` child is skipped for the next one that has it. With no match, or no `name` in any, NAME is empty.
- SRC is the string-value of the foreign property's own first `source_id` child (empty when absent).

Both children are always written, with empty text if need be (EXP-204). A Property is foreign when some `data_type` child has the string-value `foreign`, so one of two `data_type` children is enough. A `data_source` of a Property that is not foreign is copied unchanged. Each `data_source` child of a foreign Property is replaced, so two of them give two replacements.

[12.0] Same as 14.0.7.

### EXP-251: The foreign property of a foreign property

[14.0.7] In the same kind of Property, the `foreign_property` element is replaced by `<foreign_property><Item type="Property" action="get" select="id"><keyed_name>KN</keyed_name><source_id><Item type="ItemType" action="get" select="id"><name>IT</name></Item></source_id></Item></foreign_property>`. The element's own attributes and text are dropped.

- KN is the first `keyed_name` attribute in document order among the `foreign_property` children of the Property (the same value for each of them), empty when none has one.
- IT is the first `name` attribute in document order among the `data_source` children of the matching siblings that EXP-250 finds (the item property the foreign one reads through), that is, the name of the ItemType it points to. It is empty without a match, or when none of those `data_source` elements has a `name` attribute.

```xml
<!-- source: Property PB (foreign) beside Property PA (item, data_source name="Parent") -->
<!-- output -->  <data_source><Item type="Property" action="get" select="id"><name>parent</name><source_id>IT1</source_id></Item></data_source><foreign_property><Item type="Property" action="get" select="id"><keyed_name>name</keyed_name><source_id><Item type="ItemType" action="get" select="id"><name>Parent</name></Item></source_id></Item></foreign_property>
```

[12.0] Same as 14.0.7.

### EXP-252: The propertytype_id of a Field

[14.0.7] For a `propertytype_id` that is a child of an `Item` of type `Field`:

- **Dropped** (nothing written) when the string-value of the first `name` child in document order among its `Item` children of type `Property` is one of the system property names: `behavior`, `classification`, `config_id`, `created_by_id`, `created_on`, `css`, `current_state`, `generation`, `history_id`, `id`, `is_current`, `is_released`, `keyed_name`, `release_date`, `effective_date`, `locked_by_id`, `major_rev`, `managed_by_id`, `minor_rev`, `modified_by_id`, `modified_on`, `new_version`, `not_lockable`, `owned_by_id`, `permission_id`, `related_id`, `sort_order`, `source_id`, `state`, `itemtype`, `superseded_date`, `team_id`. The test is a substring test (EXP-271); with no such Item child, or none with a `name`, the name is empty and nothing is dropped. A first Property without a `name` is skipped for the next one that has it.
- Otherwise the element is copied with its attributes, and its content is the element's string-value when it has no `Item` child, else the first `id` attribute found among its `Item` children (of any type), which writes `<propertytype_id></propertytype_id>` when there is none (EXP-204).

The Field itself stays in the AML either way. The fix pass of part 2 selects Fields by the `keyed_name` attribute of `propertytype_id`, not by this embedded Property, so the two can disagree: a Field whose attribute names a system property but that has no embedded Property keeps its `propertytype_id` and also gets a fix item with empty names.

```xml
<!-- source -->  <Item type="Field" id="FL1"><propertytype_id keyed_name="name" type="Property"><Item type="Property" id="PR1"><name>name</name></Item></propertytype_id></Item><Item type="Field" id="FL2"><propertytype_id keyed_name="id" type="Property"><Item type="Property" id="PR2"><name>id</name></Item></propertytype_id></Item>
<!-- output -->  <Item type="Field" id="FL1" action="add"><propertytype_id keyed_name="name" type="Property">PR1</propertytype_id></Item><Item type="Field" id="FL2" action="add" />
```

[12.0] Same as 14.0.7.

[14.35] Same, except that a `propertytype_id` marked `is_null="1"` is dropped (EXP-380) instead of being written as `<propertytype_id is_null="1"></propertytype_id>` (probe `AX10`).

### EXP-253: The source_id of a Grid Event on a system property

[14.0.7] For a `source_id` that is a child of an `Item` of type `Grid Event` that is a child of the `Relationships` of an `Item` of type `Property`, let NAME be the string-value of that Property's first `name` child:

- when NAME is a system property name (the list of EXP-252, substring test, EXP-271) the element is replaced by `<source_id><Item type="Property" action="get" select="id"><name>NAME</name><source_id>SRC</source_id></Item></source_id>`, with SRC the string-value of the Property's own first `source_id` child (empty when absent). The element's attributes and text are dropped;
- otherwise the element is copied with its attributes and its children are handled in default mode.

A system property is itself dropped from its place by part 2's Property drop list and re-emitted by the ItemType edit item, whose pass visits the Property's relationships in default mode. So this rule is what turns that Grid Event's `source_id` into the `get` there. For a root Property it applies in the main pass. A `source_id` under any other parent, or under a Grid Event of a Property without a system name, is not changed.

```xml
<!-- source -->  <Item type="Property" id="P1"><name>state</name><source_id keyed_name="T" type="ItemType">IT1</source_id><Relationships><Item type="Grid Event" id="GE1"><source_id keyed_name="state" type="Property">P1</source_id></Item></Relationships></Item>   (root Property)
<!-- output -->  <AML><Item type="Property" id="P1" action="add"><name>state</name><source_id keyed_name="T" type="ItemType">IT1</source_id><Relationships><Item type="Grid Event" id="GE1" action="add"><source_id><Item type="Property" action="get" select="id"><name>state</name><source_id>IT1</source_id></Item></source_id></Item></Relationships></Item></AML>
```

[12.0] Same as 14.0.7.

### EXP-254: The reference of a FileSelectorTemplate is written as CDATA

[14.0.7] A `reference` element is rewritten when its path from an ItemType is exactly `Item[ItemType]/Relationships/Item[DiscussionTemplate]/Relationships/Item[FeedTemplate]/Relationships/Item[FileSelectorTemplate]/reference`, with the ItemType at any depth (the root, or one nested). The element is copied without its attributes, and its content is `<![CDATA[`, the element's string-value, `]]>`, all three written with escaping disabled. The value reaches the output raw: `<`, `&` and quotes unescaped, an entity such as `&amp;amp;` in the source (the text `&amp;`) as `&amp;` inside the CDATA, and line breaks as `\r\n`. An empty `reference` gives `<reference><![CDATA[]]></reference>`.

The value is checked like all text the transform writes: a numeric reference to a character XML cannot hold in a `reference` fails the transform (EXP-361).

A `reference` anywhere else on that path (a FeedTemplate directly under the ItemType, a root that is not an ItemType) is copied unchanged and escaped like any text. The `]]>` inside the value is not split (EXP-270).

```xml
<!-- source -->  <reference a="1">&lt;b&gt;x&lt;/b&gt; &amp;amp; "q"</reference>
<!-- output -->  <reference><![CDATA[<b>x</b> &amp; "q"]]></reference>
```

[12.0] Same as 14.0.7.

## Where the engine's conflict rules decide

### EXP-260: Priority, not order, decides every part 1 overlap

[14.0.7] Several part 1 templates can match the same node and are told apart by priority (EXP-202):

- every specific Item template (Identity, Method, Member/Morphae, Item Action, RelationshipType, ItemType under `related_id`; priority 0.5) beats the plain `Item` template (0);
- every property template (EXP-231, EXP-236, EXP-250 to EXP-254) beats the catch-all `*` (-0.5), and so do the Envelope, Body and the drop templates for elements they name;
- `Result` (0) beats `*`, and the Envelope and Body templates (0.5) beat it for those two elements.

No two part 1 templates of the same priority match one node. The Identity, Method and the Member/Morphae templates differ by `type`; each property template is fixed by the pair (parent Item type, element name), and no two share one; and no part 1 element name appears in the drop lists of part 2. So the rule "the later template wins at equal priority" never changes a part 1 result in 14.0.7. It does matter in part 2, where the Property drop templates overlap one another (all of them write nothing). Later engines add a template that beats a part 1 one (ticket 06, X3, for 14.35's `is_null` drop), which their variants record.

A mode never falls back to another mode's templates: the default-mode templates of this document handle only what `apply-templates` visits in default mode.

[12.0] Same as 14.0.7.

[14.35] The statement that no two part 1 templates of the same priority match one node no longer holds. The `is_null` drop (EXP-380, priority 0.5) matches every element marked `is_null="1"`, so it ties with the 0.5 templates of part 1 that match such an element, and wins by coming last (EXP-202): the Identity and Method Item templates, the Identity- and Method-valued properties, the Field `propertytype_id`, the Grid Event `source_id`, the foreign-property references and the FileSelectorTemplate `reference`. It also outranks the plain `Item` template (0) and the catch-all (-0.5). The result is the same for all of them: nothing is written. The port tests `is_null` before it looks at any of those templates, in default mode.

## Reproduced bugs

### EXP-270: A `]]>` in a FileSelectorTemplate reference fails the whole item

[14.0.7] The `reference` rewrite (EXP-254) writes the value raw between `<![CDATA[` and `]]>`, so a value that contains `]]>` ends the CDATA early and the remaining text is malformed. The reload then throws `XmlException` (`']]>' is not allowed in character data.`), and the item fails with `Can't export item.` (EXP-201). It is reproduced, with the same message. See `bugs.md`.

[12.0] Same as 14.0.7.

### EXP-271: Identity and system-property membership tests are substring tests

[14.0.7] The tests of EXP-230 (six system identities), EXP-252 and EXP-253 (the system property names) look the `|`-delimited name up inside one long `|`-delimited string. A name that contains `|` can therefore match as a run of several entries, such as the `keyed_name` `World|Creator`, which exports as a system Identity `get` named `World|Creator`, and the property name `state|itemtype`. A name that is a single exact entry matches as intended. It is reproduced as the engine does it. See `bugs.md`.

[12.0] Same as 14.0.7.

### EXP-272: A null Method-valued property exports as a Method `get` with an empty name

[14.0.7] A Method-valued property (EXP-236) without a `keyed_name` attribute, including a null one such as `<method is_null="1"/>`, is exported as a `get` of a Method with an empty `name`. That reference cannot be resolved at import. It is reproduced. See `bugs.md`; ticket 06 (X3) found that 14.35's `is_null` drop removes these elements instead, and the 14.35 variant records it.

[12.0] Same as 14.0.7.

[14.35] Reduced. A Method-valued property marked `is_null="1"` is dropped (EXP-380, EXP-236), so `<method is_null="1"/>` no longer exports as a `get` of a Method with an empty name. A property that has no `keyed_name` attribute and is not marked still does, and the bug stands for it (`bugs.md`, 14.35 added to the versions).

## Template index, part 1

Every part 1 template of `export.xsl`, in stylesheet order, with the rule that specifies it. The templates not listed are indexed at the end of the document ("Template index, part 2").

| `export.xsl` | Template | Rule |
|---|---|---|
| 5–16 | document node, Envelope, Body, Result | EXP-210 |
| 17–49 | `Item` in `mode="first"` | EXP-211 to EXP-214 |
| 50–56 | `reference` of a FileSelectorTemplate | EXP-254 |
| 57–76 | Grid Event `source_id` | EXP-253 |
| 78–87, 203–222 | nested Identity, named template `Identity` | EXP-230 |
| 89–95 | nested Method | EXP-235 |
| 97 | Member, Morphae | EXP-240 |
| 99 | Item Action | EXP-241 |
| 101 | RelationshipType | EXP-242 |
| 105–107 | `related_id/Item[ItemType]` | EXP-243 |
| 109–123 | Field `propertytype_id` | EXP-252 |
| 124–133, 152–172 | named template `Method`, Method-valued properties | EXP-236 |
| 134–146, 175–192 | named template `Identity_Template`, Identity-valued properties | EXP-231 |
| 194–201 | plain `Item` | EXP-220 |
| 258–287 | foreign `data_source`, `foreign_property` | EXP-250, EXP-251 |
| 455–460 | catch-all `*` | EXP-221 |

In 14.35 the stylesheet has one more row, `| 454 | `is_null` drop | EXP-380 |`, between the Morphae fix and the catch-all, and the catch-all is at lines 456–461.

## Part 2: the model

### EXP-300: Two kinds of template, and one that never runs

[14.0.7] The rest of `export.xsl` is of two kinds.

- **Drop templates** in default mode (`export.xsl:102` to `103`, `224` to `256`, `289` to `325` and `328`). They match an element or Item and write nothing, so the node and its content disappear from the main pass. They are the system-element and Property drops (EXP-310 to EXP-316).
- **`mode="fix"` templates** (`export.xsl:331` to `453`). The root template (EXP-214) applies them to nodes it selects itself, after the root Item copy: the Property items of the ItemType edit (EXP-320 to EXP-324), the Field fixes (EXP-340), the Member fixes (EXP-350) and the Morphae fixes (EXP-351). A node is handled in `fix` mode only because the root template asked for it. The ItemType fix template selects its Property items itself and visits nothing else, and the Field fix template visits no children: both build their output from `value-of`, attribute copies and literal elements. The Property, Member and Morphae fix templates copy the element and then handle its children in **default mode**, so the drop templates and the part 1 rewrites (EXP-230 to EXP-254) apply inside a fix item as they do in the main pass.

The `fix` template for `Item[@type='Field']/propertytype_id` (`export.xsl:352` to `357`, the copy of the embedded Item) is never reached: the only template that could apply it, the Field fix, does not visit its children. It has no effect on any output and the port omits it.

Part 2 examples omit the `xmlns:SOAP-ENV` declaration that EXP-205 puts on copied elements, except where a rule is about namespaces (EXP-362).

[12.0] Same as 14.0.7.

### EXP-301: The system property names and how they are tested

[14.0.7] The stylesheet holds the system property names in one string, `|behavior|classification|…|team_id|` (`export.xsl:4`), 32 names in all: `behavior`, `classification`, `config_id`, `created_by_id`, `created_on`, `css`, `current_state`, `generation`, `history_id`, `id`, `is_current`, `is_released`, `keyed_name`, `release_date`, `effective_date`, `locked_by_id`, `major_rev`, `managed_by_id`, `minor_rev`, `modified_by_id`, `modified_on`, `new_version`, `not_lockable`, `owned_by_id`, `permission_id`, `related_id`, `sort_order`, `source_id`, `state`, `itemtype`, `superseded_date`, `team_id`. It is the list of EXP-252.

Two kinds of test use it, and they behave differently when an element occurs more than once:

- **Substring test**: `contains(list, '|' + NAME + '|')`. The fix passes and the Field selection use it (EXP-321, EXP-322, EXP-324, EXP-340). NAME is the string-value of the **first** `name` child (for the Field selection, the first `keyed_name` attribute of the Field's `propertytype_id` children), and a NAME that contains `|` can match a run of several entries (EXP-271, EXP-393). EXP-230, EXP-252 and EXP-253 of part 1 use the same kind of test.
- **Equality test**: `name = 'id'`. The drop templates (EXP-310) and the per-property rows of the comparison (EXP-322) use it. It is true when **any** `name` child of the Property has exactly that string-value.

For a Property with a single `name` child, the two agree on every name except those containing `|`.

[12.0] Same as 14.0.7.

## Dropped Properties and elements

### EXP-310: Properties dropped from ItemType definitions

[14.0.7] A nested Item of type `Property` writes nothing in three cases:

1. it has an `is_keyed` child whose value is exactly `1`;
2. it has a `name` child equal to one of the 29 names `behavior`, `classification`, `config_id`, `created_by_id`, `created_on`, `css`, `current_state`, `generation`, `history_id`, `id`, `is_current`, `is_released`, `keyed_name`, `locked_by_id`, `major_rev`, `managed_by_id`, `minor_rev`, `modified_by_id`, `modified_on`, `new_version`, `not_lockable`, `owned_by_id`, `permission_id`, `related_id`, `sort_order`, `source_id`, `state`, `itemtype`, `team_id`;
3. it has a `name` child equal to `effective_date`, `release_date` or `superseded_date`, and the Item two levels up (the ItemType whose `Relationships` holds the Property) has an `is_versionable` child equal to `1`. In an ItemType that is not versionable these three properties are ordinary Properties and stay in the AML.

Comparisons are exact: no trimming, case-sensitive (`Id`, ` id ` and `ID` stay). The rule applies to a nested Property wherever it sits (under a Form, inside another property), not to a root Property (EXP-213), but it does apply to Properties nested in a root Property's relationships.

The dropped Properties are not lost. The fix pass re-emits the keyed ones and the modified system ones as edits of the ItemType (EXP-320). A Property dropped anywhere else is lost: a keyed Property under a Form, or under a root that is neither an ItemType nor the RelationshipType whose embedded ItemType is fixed (EXP-325), exports nothing.

```xml
<!-- source: ItemType IT1, not versionable, with Properties named id (P0), custom (P1), Id (P2), effective_date (P3) and a keyed k (P4) -->
<!-- output -->  <AML><Item type="ItemType" id="IT1" action="add"><name>Foo</name><Relationships><Item type="Property" id="P1" action="add"><name>custom</name></Item><Item type="Property" id="P2" action="add"><name>Id</name></Item><Item type="Property" id="P3" action="add"><name>effective_date</name></Item></Relationships></Item><Item type="ItemType" id="IT1" action="edit"><Relationships><Item type="Property" id="P4" action="add"><name>k</name><is_keyed>1</is_keyed></Item><Item type="Property" action="edit" where="source_id='' and name='id'"><name>id</name></Item></Relationships></Item><Item type="View" action="delete" where="source_id='IT1'" /><Item type="Form" action="delete" where="name='Foo'" /></AML>
```

P4 and P0 come back in the ItemType edit (EXP-320). P0 is there only because it has no stock columns (EXP-322).

[12.0] Same as 14.0.7.

### EXP-311: System elements dropped everywhere

[14.0.7] An element with one of these 25 names writes nothing, with its content, wherever it sits in the tree. It need not be a child of an Item; a child of a plain container element, or of a `Relationships`, is dropped too:

`cache_query`, `config_id`, `core`, `created_by_id`, `created_on`, `current_state`, `generation`, `history_id`, `id`, `is_cached`, `is_current`, `is_released`, `keyed_name`, `locked_by_id`, `major_rev`, `minor_rev`, `modified_by_id`, `modified_on`, `new_version`, `not_lockable`, `state`, `itemtype`, `release_date`, `effective_date`, `superseded_date`.

The match is on the unprefixed name in no namespace, case-sensitive (`ID` stays, `x:id` in a namespace stays). Attributes are not affected. A container whose only content was dropped is written `<x />` (EXP-244). The system columns that are not on this list are copied like any element: `classification`, `managed_by_id`, `owned_by_id`, `permission_id`, `team_id`, `sort_order`, `source_id` and `related_id`.

This rule drops the element `id`, not the attribute, so part 1's lookup of a sibling Property by its `id` child (EXP-250) reads the source tree, where the element still exists.

```xml
<!-- source -->  <Item type="Foo" id="1"><id>i</id><config_id>c</config_id><x><state>s</state></x><sort_order>128</sort_order><keyed_name type="x"><Item type="Foo" id="9"/></keyed_name></Item>
<!-- output -->  <AML><Item type="Foo" id="1" action="add"><x /><sort_order>128</sort_order></Item></AML>
```

[12.0] Same as 14.0.7.

### EXP-312: Elements dropped only for some parents

[14.0.7] Three more element names are dropped by conditions on their parent. In each, the parent must be an `Item` that has a `type` attribute: an Item with no `type` attribute, or a parent that is not an Item, never satisfies a `!=` test, so the element is kept.

- **`behavior`**: dropped when the parent's `type` is anything but `RelationshipType`. A RelationshipType keeps its `behavior`, whether root or nested.
- **`css`**: dropped when the parent's `type` is neither `Field` nor `Body`. Fields and Bodies keep their `css`.
- **`item_behavior`**: dropped when the parent is a `Property` that has a `data_type` child whose value differs from `item`. With several `data_type` children one differing value is enough. A Property with no `data_type` child keeps it; an empty or null `data_type` differs and drops it; `Item` in capitals differs and drops it. A non-Property parent keeps it.

Type names are compared exactly. The rule also applies to the children of a root Item (EXP-213).

```xml
<!-- source -->  <Item type="ItemType" id="1"><name>T</name><Relationships><Item type="Property" id="P1"><name>a</name><data_type>list</data_type><item_behavior>b</item_behavior></Item><Item type="Property" id="P2"><name>b</name><data_type>item</data_type><item_behavior>b</item_behavior></Item></Relationships></Item>
<!-- output -->  <AML><Item type="ItemType" id="1" action="add"><name>T</name><Relationships><Item type="Property" id="P1" action="add"><name>a</name><data_type>list</data_type></Item><Item type="Property" id="P2" action="add"><name>b</name><data_type>item</data_type><item_behavior>b</item_behavior></Item></Relationships></Item><Item type="View" action="delete" where="source_id='1'" /><Item type="Form" action="delete" where="name='T'" /></AML>
```

[12.0] Same as 14.0.7.

### EXP-313: Autogenerated columns dropped

[14.0.7] Two columns that the server fills in are dropped:

- `generated_type` of an Item of type `cmf_ElementType` or `cmf_PropertyType`;
- `execution_count` of an Item of type `SQL`.

The same name under another type (`cmf_Other`, a lower-case `sql`) is kept.

[12.0] Same as 14.0.7.

### EXP-314: Variable value and default_value

[14.0.7] Two templates trim an Item of type `Variable` (root or nested), each applied to every `value` or `default_value` child separately:

- a `value` child is dropped when its string-value is empty (no content, only comments or processing instructions, an empty CDATA section, `is_null="1"` with no text), **or** when one of its own text nodes equals one of the text nodes of one of the Variable's `default_value` children;
- a `default_value` child is dropped when its string-value is empty.

A "text node" is what XPath sees: a maximal run of adjacent text, whitespace and CDATA nodes, which is how the .NET `XPathNavigator` merges them. A comment or processing instruction ends a run, so `a<!--c-->b` holds the two text nodes `a` and `b`, and `a<![CDATA[b]]>` holds one text node `ab`. Only a child's own text counts, not text inside a child element, so `<value>a<b>c</b></value>` against `<default_value>c</default_value>` is not equal. Strings compare exactly: no trimming, case-sensitive, and `1` is not `1.0`.

The test reads the source, so it does not depend on the default being kept. The usual result is a Variable with only its `default_value`.

| `value` | `default_value` | exported |
|---|---|---|
| `x` | `x` | `default_value` only |
| `x` | `y` | both |
| empty | `y` | `default_value` only |
| `x` | empty | `value` only |
| empty | empty | neither |
| ` ` | none | `value` (a blank is not empty) |
| `a<!--c-->b` | `ab` | both (two text nodes) |
| `a<![CDATA[b]]>` | `ab` | `default_value` only |

A `value` or `default_value` of anything but a Variable is not touched, and neither is one under a Variable's nested Items.

[12.0] Same as 14.0.7.

### EXP-315: User pwd_is_set_on

[14.0.7] The `pwd_is_set_on` child of an Item of type `User` writes nothing. The same element under another type, or deeper under the User (inside a plain container element), is kept.

[12.0] There is no such template. The `pwd_is_set_on` child of a `User` is an ordinary property: it is written like any other child that the other rules keep. Not observed: the 12.0 SP9 server holds the property, but the users read on dev had no value (a null property is left out of the answer by the default `select`), so the 12.0 and 14.0.7 files of those users are identical.

### EXP-316: Empty Relationships containers

[14.0.7] A `Relationships` element (no namespace, exact case) with no element children writes nothing. Text, whitespace, comments and processing instructions do not count as children, so `<Relationships>\n</Relationships>` is dropped. A `Relationships` whose children are all Items that other templates drop is not empty in the source and stays as `<Relationships />` (EXP-244). The rule applies in every position: the root's, a nested Item's, a Property's, and inside fix items.

```xml
<!-- source -->  <Item type="Foo" id="1"><Relationships/><a><Relationships>text</Relationships></a><f><Relationships><Item type="Member" id="M"/></Relationships></f></Item>
<!-- output -->  <AML><Item type="Foo" id="1" action="add"><a /><f><Relationships /></f></Item></AML>
```

[12.0] Same as 14.0.7.

## The ItemType edit item

### EXP-320: When the ItemType edit is written, and its shape

[14.0.7] For each ItemType the root template fixes (EXP-325), the transform writes one extra Item, **the ItemType edit**, if at least one of two sets is not empty: the keyed Properties K (EXP-321) or the modified system Properties M (EXP-322). Otherwise it writes nothing, and the ItemType's own `Relationships` stay as the main pass wrote them.

The edit is a copy of the ItemType element (so it carries namespace declarations, EXP-362) with exactly these attributes, in this order: `type`, `id` if the source has one, `action="edit"`. Nothing else is copied: no `name`, no `dependencyLevel`, no other attribute or child. It holds one literal `Relationships` element, which holds the Property items of K in document order and then those of M in document order (EXP-324). A Property is in at most one of the two sets.

The edit follows the `add` of the same ItemType in the AML, and is how a keyed Property and a modified system Property reach the type although the main pass dropped them (EXP-310).

```xml
<!-- source -->  <Item type="ItemType" id="IT1"><name>Foo</name><Relationships><Item type="Property" id="P1"><name>behavior</name><label is_null="1"/><data_type>list</data_type><stored_length>64</stored_length><column_alignment>left</column_alignment><is_hidden>1</is_hidden><is_hidden2>1</is_hidden2><column_width></column_width><readonly>1</readonly><is_keyed>0</is_keyed><order_by></order_by></Item><Item type="Property" id="P2"><name>mykey</name><is_keyed>1</is_keyed></Item></Relationships></Item>
<!-- output -->  <AML><Item type="ItemType" id="IT1" action="add"><name>Foo</name><Relationships /></Item><Item type="ItemType" id="IT1" action="edit"><Relationships><Item type="Property" id="P2" action="add"><name>mykey</name><is_keyed>1</is_keyed></Item><Item type="Property" action="edit" where="source_id='' and name='behavior'"><name>behavior</name><label is_null="1" /><data_type>list</data_type><stored_length>64</stored_length><column_alignment>left</column_alignment><is_hidden>1</is_hidden><is_hidden2>1</is_hidden2><column_width /><readonly>1</readonly><is_keyed>0</is_keyed><order_by /></Item></Relationships></Item><Item type="View" action="delete" where="source_id='IT1'" /><Item type="Form" action="delete" where="name='Foo'" /></AML>
```

The keyed Property comes first although it is second in the source. The `where` has an empty `source_id` here only because the example Property has no `source_id` child (EXP-324).

[12.0] Same as 14.0.7.

### EXP-321: The keyed Properties

[14.0.7] For an ItemType I, K is the Property Items that are children of any `Relationships` child of I (an ItemType can have several), in document order, that have an `is_keyed` child equal to `1` (any one of several) and whose first `name` child is not a system property name by the substring test (EXP-301). A keyed system Property is not in K, it can be in M (EXP-322, because `is_keyed` is compared there). A Property whose `is_keyed` is ` 1 ` is not keyed.

[12.0] Same as 14.0.7.

### EXP-322: The modified system Properties

[14.0.7] For an ItemType I, let PROPS be the Property Items that are children of any `Relationships` child of I. M is the union of two selections, each Property once and in document order:

- **(a) By name and stock values.** A Property in PROPS that has a `name` child equal to one of the 32 system names N (equality test, EXP-301), and that deviates from the stock row of N in the table of EXP-323. The three dated names (`effective_date`, `release_date`, `superseded_date`) are looked at only when I has an `is_versionable` child equal to `1`.
- **(b) By content.** A Property in PROPS whose first `name` child is a system name (substring test) and that has a `Relationships` child with at least one child node of any kind: an Item, but also whitespace text, text, a comment or a processing instruction. A system Property that is stock in every other way is still exported when it carries a `Relationships` holding only `\n`.

A Property "deviates from the stock row" when any of these is true. The row holds the values the stylesheet treats as unmodified.

- **label**, for a row whose label is `null`: some `label` child exists whose `is_null` attribute is not exactly `1`. A row with a label text: the string-value of the first `label` child differs from that text; without a `label` child the string-value is empty and so differs.
- **data_type**, **stored_length**, **column_alignment**, **is_hidden**, **is_hidden2**, **column_width**, **readonly**, **is_keyed**, **order_by**: the string-value of the first child of that name differs from the stock value. An absent child has the string-value empty, so it deviates exactly where the stock value is not empty (a Property without `is_hidden` is modified, one without `column_width` is not). Values are compared exactly: no trimming, and attributes such as `is_null` on these children are ignored.
- **default_value**: some `default_value` child exists whose `is_null` attribute is not exactly `1`. An empty `<default_value/>` counts. The stock default is null.

Nothing else is compared: not `help_text`, `default_pattern`, `pattern`, `is_required`, `track_history`, `sort_order` or any other column. Extra children of a Property are carried through (EXP-324) but never select it.

Selection (b) is separate: a Property chosen by (b) and by (a) is written once. In a non-versionable ItemType the three dated Properties are not selected by (a) and, being kept in the main pass (EXP-310), are written twice when (b) selects them: once in the ItemType and once as an edit.

Several `name` children are possible only in a hand-made document, but they decide the result: (a) uses any `name` child, the Property item of EXP-324 and (b) use the first. A Property named `custom` then `id` is selected by (a) for `id`, and is written with no `id`, `action` or `where` at all (EXP-324, last case).

```xml
<!-- source: an id Property with its stock values (EXP-323) and <Relationships>\n</Relationships> -->
<!-- output -->  <AML><Item type="ItemType" id="IT1" action="add"><name>Foo</name><Relationships /></Item><Item type="ItemType" id="IT1" action="edit"><Relationships><Item type="Property" action="edit" where="source_id='' and name='id'"><name>id</name><label is_null="1" /><data_type>item</data_type><stored_length /><column_alignment>left</column_alignment><is_hidden>1</is_hidden><is_hidden2>1</is_hidden2><column_width /><readonly>1</readonly><is_keyed>0</is_keyed><order_by /></Item></Relationships></Item><Item type="View" action="delete" where="source_id='IT1'" /><Item type="Form" action="delete" where="name='Foo'" /></AML>
```

[12.0] Same as 14.0.7.

[14.35] Selection (a) has one more alternative: a Property in PROPS whose name is one of the 32 and whose own `export_has_translations` attribute is exactly `1` is selected whatever its values are (EXP-381). Selection (b) is unchanged.

### EXP-323: The stock values

[14.0.7] The comparison of EXP-322 (a), per system property. The columns `column_alignment` (stock `left`), `is_hidden` and `is_hidden2` (stock `1` and `1`), `column_width` (empty), `is_keyed` (`0`) and `order_by` (empty) are the same for every row except where the last column says otherwise. `null` in the label column means a null label (EXP-322).

| Property | label | data_type | stored_length | readonly | Differences from the common values |
|---|---|---|---|---|---|
| `behavior` | null | `list` | `64` | `0` | |
| `classification` | `Classification` | `string` | `512` | `0` | |
| `config_id` | null | `item` | empty | `1` | |
| `created_by_id` | null | `item` | empty | `1` | |
| `created_on` | null | `date` | empty | `1` | |
| `css` | null | `text` | empty | `0` | |
| `current_state` | null | `item` | empty | `1` | |
| `generation` | null | `integer` | empty | `1` | |
| `history_id` | `History Id` | `item` | empty | `0` | |
| `id` | null | `item` | empty | `1` | |
| `is_current` | null | `boolean` | empty | `1` | `order_by` is not compared (EXP-391) |
| `is_released` | `Released` | `boolean` | empty | `1` | |
| `keyed_name` | null | `string` | `128` | `0` | |
| `locked_by_id` | null | `item` | empty | `1` | |
| `major_rev` | null | `string` | `8` | `0` | |
| `managed_by_id` | null | `item` | empty | `0` | |
| `minor_rev` | null | `string` | `8` | `0` | |
| `modified_by_id` | null | `item` | empty | `1` | |
| `modified_on` | null | `date` | empty | `1` | |
| `new_version` | null | `boolean` | empty | `1` | |
| `not_lockable` | `Not Lockable` | `boolean` | empty | `1` | |
| `owned_by_id` | null | `item` | empty | `0` | |
| `permission_id` | null | `item` | empty | `1` | |
| `related_id` | null | `item` | empty | `0` | `is_hidden` is `0` |
| `sort_order` | null | `integer` | empty | `0` | |
| `source_id` | null | `item` | empty | `0` | |
| `state` | null | `string` | `32` | `1` | |
| `effective_date` | `Effective Date` | `date` | empty | `0` | versionable ItemTypes only |
| `release_date` | `Release Date` | `date` | empty | `1` | versionable ItemTypes only |
| `superseded_date` | `Superseded Date` | `date` | empty | `1` | `is_hidden` and `is_hidden2` are `0`; versionable ItemTypes only |
| `itemtype` | `ItemType` | `list` | empty | `0` | |
| `team_id` | `Team` | `item` | empty | `0` | |

The port holds this table as data. Probes changed each of the 11 compared fields of every row to another value and removed it, and the selection matched the table in all 772 cases.

[12.0] Same as 14.0.7.

### EXP-324: A Property item inside the ItemType edit

[14.0.7] Each Property of K and M is written as a copy of the Property element with the attribute `type` first, then the attributes of the **first** of these cases that applies (NAME is the string-value of its first `name` child):

1. NAME is `related_id`, `sort_order` or `source_id` (substring test against `|related_id|sort_order|source_id|`) and **some** `source_id` child has a `keyed_name` attribute equal to `Change Controlled Relationship`: `id` (if present), then `action="add"`. So these three are added with their ids, not edited, when they belong to the Change Controlled Relationship ItemType. (The stylesheet's own comment on the keyed additions says only that, for a relationship such as the Field Event one, `source_id`, `related_id` and a further property share one general index and must be imported together.)
2. NAME is a system property name (substring test): `action="edit"`, then `where="source_id='S' and name='N'"`, where S is the string-value of the first `source_id` child (the owning ItemType's id; empty when absent) and N is NAME. No `id`.
3. Some `is_keyed` child equals `1`: `id` (if present), then `action="add"`.
4. None of these: no further attribute. It is reachable only for a Property with several `name` children (EXP-322).

The children are then handled in **default mode**: every drop rule applies (a Property's own `id` and `keyed_name` children go, EXP-311), `source_id` stays, a nested `Relationships` is trimmed (EXP-316), and the part 1 rewrites apply, so a keyed foreign Property gets its `data_source` and `foreign_property` references (EXP-250, EXP-251) and a Grid Event inside a system Property gets its rewritten `source_id` (EXP-253). A Property keeps children the engine never compares (EXP-322).

`S` and `N` are inserted into the `where` text unescaped, apart from the XML escaping of the attribute, so an apostrophe in either breaks the clause (EXP-390).

```xml
<!-- source: two keyed system Properties, sort_order (P2) with source_id keyed_name Other, and related_id (P3) whose first source_id is a Change Controlled Relationship -->
<!-- output: the ItemType edit's Relationships -->  <Item type="Property" action="edit" where="source_id='X' and name='sort_order'"><name>sort_order</name><is_keyed>1</is_keyed><source_id keyed_name="Other" type="ItemType">X</source_id></Item><Item type="Property" id="P3" action="add"><name>related_id</name><is_keyed>1</is_keyed><source_id type="ItemType" keyed_name="Change Controlled Relationship">X</source_id><source_id keyed_name="Z">Y</source_id></Item>
```

[12.0] Case 1 does not exist. Only the three cases that follow apply, in this order:

1. NAME is a system property name (substring test): `action="edit"`, then `where="source_id='S' and name='N'"`, as in case 2 of 14.0.7. This includes `related_id`, `sort_order` and `source_id` of the Change Controlled Relationship ItemType: they are edited, not added, and carry no `id`.
2. Some `is_keyed` child equals `1`: `id` (if present), then `action="add"`.
3. None of these: no further attribute.

The children are handled as in 14.0.7. Observed on dev (the ItemType `Change Controlled Relationship`): the 12.0 file has `<Item type="Property" action="edit" where="source_id='2A5BB1A93BDC436B824B9FFE6DB89553' and name='related_id'">`, and likewise for `sort_order` and `source_id`, where the 14.0.7 file has `<Item type="Property" id="…" action="add">` for the same three Properties, and nothing else differs.

[14.35] Same selection and attributes. The children are handled in default mode (above), where the `is_null` drop of EXP-380 now applies: a `label` or `default_value` child marked `is_null="1"` is no longer written. Both are written in 14.0.7 as `<label is_null="1" />` and `<default_value is_null="1" />`. The loss is a bug (EXP-395).

### EXP-325: Which ItemTypes get the edit

[14.0.7] The root template (EXP-214) fixes:

- the root Item when its `type` is `ItemType`;
- when its `type` is `RelationshipType`, every Item of type `ItemType` that is a child of its `relationship_id` children, in document order, one edit each. The RelationshipType's own `Relationships` are not fixed, and its Properties are dropped (EXP-310).

No other Item is fixed: an ItemType nested anywhere else (under `source_id`, in `Relationships` of another Item) exports its keyed and modified system Properties nowhere. A `relationship_id` Item of another type gives no edit. The View/Form delete items (EXP-330) are decided separately.

[12.0] Same as 14.0.7.

## Follow-up items after the root Item

### EXP-330: View and Form delete items

[14.0.7] An ItemType exported with no View of its own gets a pair of delete items that remove the View and Form the server generates for a new ItemType (the stylesheet's comment calls them the autogenerated ones). Two tests decide, both on the root Item and independent of one another. Each writes a pair: first `<Item type="View" action="delete" where="source_id='ID'"/>`, then `<Item type="Form" action="delete" where="name='NAME'"/>`. Both are literal elements with no namespace declaration.

- **T1.** The root's `type` is `ItemType` and none of its `Relationships` children has an Item child of type `View`. ID is the root's `id` attribute (empty when absent); NAME is the string-value of its first `name` child.
- **T2.** The root has a `relationship_id` child with an Item child, **of any type and any root type**, and none of the Items in `relationship_id` has a `Relationships` child holding an Item of type `View`. ID is the `id` attribute of the first such Item in document order, NAME the string-value of the first `name` child of those Items in document order.

Both tests fire for an ItemType root that has a `relationship_id` Item. T1 pairs come first. A `Relationships` holding only whitespace, only a View nested a level deeper, or only an Item of type `view` does not count as having a View. A `relationship_id` that holds only text (an id) does not satisfy T2.

ID and NAME are interpolated into the attribute text as they are. The attribute writer escapes `&` as `&amp;`, `<` as `&lt;`, `>` as `&gt;`, `"` as `&quot;`, line feed as `&#xA;`, carriage return as `&#xD;` and tab as `&#x9;`, and writes `'` as it is, so a name with an apostrophe produces a clause that ends early (EXP-390).

```xml
<!-- source -->  <Item type="ItemType" id="I&amp;D"><name>O'Neil "x"</name></Item>
<!-- output -->  <AML><Item type="ItemType" id="I&amp;D" action="add"><name>O'Neil "x"</name></Item><Item type="View" action="delete" where="source_id='I&amp;D'" /><Item type="Form" action="delete" where="name='O'Neil &quot;x&quot;'" /></AML>
```

[12.0] Same as 14.0.7.

### EXP-340: Field fix items

[14.0.7] A Field whose data source is a system property loses its `propertytype_id` in the main pass (EXP-252), and an import would not know the source. The root template therefore adds, for each Field, an edit that sets the property back by name.

**Selection.** Every Item of type `Field` anywhere in the source document (the root, a nested one, one inside a property element), in document order, whose `propertytype_id` child has a `keyed_name` attribute that is a system property name by the substring test (EXP-301). With several `propertytype_id` children the first `keyed_name` attribute found decides. This looks at the **attribute**, where EXP-252 looks at the embedded Property's `name`; they can disagree, in which case a Field gets the fix but keeps its `propertytype_id`, or loses its `propertytype_id` and gets no fix.

**Output.** A copy of the Field element with attributes `type`, `id` (if present) and `action="edit"`, then nothing but:

1. a comment with the text ` Please note: this AML depends on the "KN" ItemType. Please make sure it exists before running this. ` (a space after `<!--` and before `-->`);
2. `<propertytype_id><Item type="Property" action="get" select="id"><name>NAME</name><source_id type="T" keyed_name="KN">SRC</source_id></Item></propertytype_id>`.

In what follows, the embedded Items are the `Item` children, of any type, of the Field's `propertytype_id` children, in document order. NAME is the string-value of the first `name` child of the embedded Items. SRC is the string-value of the first `source_id` child of the embedded Items (all text below it, so an expanded `source_id` gives the nested name). `T` and `KN` are the **first** `type` and `keyed_name` attributes found among the `source_id` children of the embedded Items, in document order, which can belong to a later `source_id` than SRC. The comment repeats KN. Everything is empty when the Field has no embedded Item, and the elements are still written, with empty attributes and, because `value-of` writes text, `<name></name>` and `<source_id …></source_id>` (EXP-363). No other child or attribute of the Field is copied, and the Field's children are not visited.

The comment text is written as the writer does (EXP-361): `--` in KN becomes `- -`, line breaks become `\r\n`.

```xml
<!-- source -->  <Item type="Form" id="FO1"><Relationships><Item type="Field" id="FL2"><name>fm</name><propertytype_id keyed_name="id" type="Property"><Item type="Property" id="PR2"><name>id</name><source_id keyed_name="Part" type="ItemType">IT1</source_id></Item></propertytype_id></Item></Relationships></Item>
<!-- output -->  <AML><Item type="Form" id="FO1" action="add"><Relationships><Item type="Field" id="FL2" action="add"><name>fm</name></Item></Relationships></Item><Item type="Field" id="FL2" action="edit"><!-- Please note: this AML depends on the "Part" ItemType. Please make sure it exists before running this. --><propertytype_id><Item type="Property" action="get" select="id"><name>id</name><source_id type="ItemType" keyed_name="Part">IT1</source_id></Item></propertytype_id></Item></AML>
```

[12.0] Same as 14.0.7.

### EXP-350: Member fix items

[14.0.7] Each Item of type `Member` that is a child of a `Relationships` child of the **root** Item, in document order, is written again after the Field fixes: a copy of the Member with attributes `type`, `id` (if present), `action="add"`, whose children are handled in default mode (so a `related_id` Identity becomes the Identity rule's result, EXP-230, and the drop rules apply). It is a top-level Item of the AML, not inside the root. The main pass dropped the Member from its place (EXP-240), so that Identities exist before the Members refer to them.

```xml
<!-- source -->  <Item type="Identity" id="ID1"><name>I</name><Relationships><Item type="Member" id="M1"><source_id keyed_name="I" type="Identity">ID1</source_id><related_id keyed_name="World" type="Identity"><Item type="Identity" id="W"><keyed_name>World</keyed_name></Item></related_id></Item></Relationships></Item>
<!-- output -->  <AML><Item type="Identity" id="ID1" action="add"><name>I</name><Relationships /></Item><Item type="Member" id="M1" action="add"><source_id keyed_name="I" type="Identity">ID1</source_id><related_id keyed_name="World" type="Identity"><Item type="Identity" action="get" select="id"><name>World</name></Item></related_id></Item></AML>
```

A Member anywhere else is dropped for good (EXP-394).

[12.0] Same as 14.0.7.

### EXP-351: Morphae fix items

[14.0.7] Each Item of type `Morphae` that is a child of a `Relationships` child of the root Item, in document order, is written after the Members, each in its own wrapper: the literal `<Item type="ItemType" id="ROOTID" action="edit"><Relationships>` and then the Morphae copy (attributes `type`, `id` if present, `action="add"`; children in default mode, so a `related_id` ItemType collapses to its id, EXP-243). ROOTID is the root's `id` attribute, and the attribute is written empty when the root has none. The wrapper's `type` is always `ItemType`, whatever the root is. The wrapper is a literal element and carries no namespace declaration; the Morphae copy does (EXP-362). The wrapper is written once per Morphae, so two Morphae give two wrappers. The main pass dropped them in place (EXP-240), so the ItemTypes they refer to exist first.

```xml
<!-- source -->  <Item type="ItemType" id="IT1"><name>Foo</name><Relationships><Item type="Morphae" id="MO1"><related_id keyed_name="Bar" type="ItemType"><Item type="ItemType" id="IT2" keyed_name="Bar"><name>Bar</name></Item></related_id></Item><Item type="Morphae" id="MO2"/></Relationships></Item>
<!-- output -->  <AML><Item type="ItemType" id="IT1" action="add"><name>Foo</name><Relationships /></Item><Item type="View" action="delete" where="source_id='IT1'" /><Item type="Form" action="delete" where="name='Foo'" /><Item type="ItemType" id="IT1" action="edit"><Relationships><Item type="Morphae" id="MO1" action="add"><related_id keyed_name="Bar" type="ItemType">IT2</related_id></Item></Relationships></Item><Item type="ItemType" id="IT1" action="edit"><Relationships><Item type="Morphae" id="MO2" action="add" /></Relationships></Item></AML>
```

[12.0] Same as 14.0.7.

### EXP-352: The order of everything in an AML

[14.0.7] Within the `<AML>` of one root Item the transform writes, in this order:

1. the root Item copy (EXP-212);
2. the ItemType edits, one per fixed ItemType (EXP-320, EXP-325);
3. the T1 View and Form deletes, then the T2 pair (EXP-330);
4. the Field fixes, in document order (EXP-340);
5. all Member fixes, in document order (EXP-350);
6. all Morphae fixes, in document order (EXP-351).

Members before Morphae even when the source interleaves them. Each of these is one top-level child of `<AML>`; the copies carry their own namespace declarations (EXP-362).

```xml
<!-- source: Relationships holds Morphae MO1, Member M1, Morphae MO2, Member M2 -->
<!-- output -->  <AML><Item type="Foo" id="F1" action="add"><Relationships /></Item><Item type="Member" id="M1" action="add" /><Item type="Member" id="M2" action="add" /><Item type="ItemType" id="F1" action="edit"><Relationships><Item type="Morphae" id="MO1" action="add" /></Relationships></Item><Item type="ItemType" id="F1" action="edit"><Relationships><Item type="Morphae" id="MO2" action="add" /></Relationships></Item></AML>
```

[12.0] Same as 14.0.7.

## What the output writer does to part 2's items

### EXP-360: The cdata-section-elements list

[14.0.7] The stylesheet's `xsl:output` (`export.xsl:3`) declares twelve `cdata-section-elements`, in this order: `html_code`, `method_code`, `sqlserver_body`, `stylesheet`, `query`, `class_structure`, `report_query`, `xsl_stylesheet`, `implementation_query`, `filter_xml`, `condition_xml`, `event_data`. Its method is `xml` with no declaration (EXP-201).

An **output** element with one of these names writes its text children as CDATA. The match is on the element's name in no namespace, exact case, wherever the element is written: in the main pass, in a fix item, below any parent. `Method_code`, `method_code2`, `m:method_code` and a `method_code` with a default namespace are plain elements, and so is an element merely carrying an attribute of that name. The element sits in the output; the rule does not look at the source element's type or position. Ticket 06 (X4) sets how the text is written:

- Every text run is one CDATA section holding the text unescaped: `<`, `>` and `&` stay raw.
- `]]>` in the text ends the section and starts another: `a]]>b` is `<![CDATA[a]]]]><![CDATA[>b]]>`, once for each occurrence.
- Text that is only whitespace is still a CDATA section: ` ` is `<![CDATA[ ]]>`.
- Line breaks inside it are written `\r\n` (EXP-361).
- Comments and processing instructions below the element write nothing, so the text around them joins into one section: `a<!--c-->b` is `<![CDATA[ab]]>`. Text and a CDATA section in the source are the same text, and adjacent ones join.
- Child elements split the text: `t<k>u</k>v` is `<![CDATA[t]]><k>u</k><![CDATA[v]]>`. A child that is itself listed nests its own CDATA.
- An element that received no text node is `<x />`, not an empty section: `<method_code/>` and `<method_code><!--c--></method_code>` give `<method_code />`. One that received a zero-length text node (an empty CDATA section in the source, EXP-204) is written `<method_code><![CDATA[]]></method_code>`.

An invalid character in the text fails the transform (EXP-361). What the reload and the item writer do with the CDATA sections belongs to `EXP-400` to `EXP-499`.

```xml
<!-- source -->  <Item type="Foo" id="1"><method_code>a]]&gt;b &lt;x&gt; &amp;
line2</method_code><event_data/><query>   </query><condition>a&lt;b</condition></Item>
<!-- output -->  <AML><Item type="Foo" id="1" action="add"><method_code><![CDATA[a]]]]><![CDATA[>b <x> &
line2]]></method_code><event_data /><query><![CDATA[   ]]></query><condition>a&lt;b</condition></Item></AML>
```

[12.0] The stylesheet's `xsl:output` declares ten `cdata-section-elements`, in this order: `html_code`, `method_code`, `sqlserver_body`, `stylesheet`, `query`, `class_structure`, `report_query`, `xsl_stylesheet`, `filter_xml`, `condition_xml`. `implementation_query` and `event_data` are not in the list. Their text is written as ordinary escaped text (`<`, `>` and `&` as entities), where 14.0.7 writes CDATA. Everything else in this rule is as in 14.0.7, for the ten names.

### EXP-361: Line breaks, attribute values, comments and invalid characters

[14.0.7] Part 2 writes values that part 1 does not: text inside CDATA, interpolated attribute values, and a comment. Ticket 06 (X6) has the general writer rules. What part 2 adds:

- **Line breaks.** In element text, CDATA and comments, a line feed, a carriage return and a carriage return plus line feed are each written `\r\n`. So `l1\r\nl2\nl3\rl4` is four lines joined by `\r\n`, and a lone `\r` at the end of the text gives a trailing `\r\n`. Tabs are written as they are.
- **Attribute values** (the `where` of EXP-324 and EXP-330, the `type` and `keyed_name` of EXP-340): `&` is `&amp;`, `<` is `&lt;`, `>` is `&gt;`, `"` is `&quot;`, line feed `&#xA;`, carriage return `&#xD;`, tab `&#x9;`. `'` is written as it is. A carriage return plus line feed gives both references.
- **Comments.** The comment of EXP-340 writes its text as it is (`&`, `<`, `"` raw) with line breaks as above, except that a hyphen followed by a hyphen gets a space after the first: `a--b` is `a- -b`, `a---b` is `a- - -b`, `a----c` is `a- - - -c`. The comment always ends with a space, so a trailing hyphen needs no extra rule.
- **Invalid characters.** Text, an attribute value, a comment or a CDATA section that contains a character outside the XML 1.0 character set (U+0000 to U+0008, U+000B, U+000C, U+000E to U+001F, U+FFFE, U+FFFF) makes the transform throw `System.ArgumentException` with the message `'<the character>', hexadecimal value 0x01, is an invalid character.`, naming the character's own value (`0x0B`, `0xFFFE`). An unpaired surrogate throws the same exception type with the message `The surrogate pair (0xD800, 0x79) is invalid. A high surrogate character (0xD800 - 0xDBFF) must always be paired with a low surrogate character (0xDC00 - 0xDFFF).`, naming the surrogate and the code unit after it. `ApplyXsl` wraps either like any transform failure (EXP-201). Such a character can only reach the source as a numeric reference (`&#1;`), which the parser accepts. This holds for the whole stylesheet, part 1 output included. U+007F, U+0085, U+009F, U+00A0, U+2028, U+FDD0 and characters beyond the Basic Multilingual Plane are valid and written as they are.

```xml
<!-- source: a Field fix whose source_id has keyed_name="a--b" -->
<!-- output (the Field fix) -->  <Item type="Field" id="FL1" action="edit"><!-- Please note: this AML depends on the "a- -b" ItemType. Please make sure it exists before running this. --><propertytype_id><Item type="Property" action="get" select="id"><name>id</name><source_id type="ItemType" keyed_name="a--b">I1</source_id></Item></propertytype_id></Item>
```

[12.0] Same as 14.0.7.

### EXP-362: Namespace declarations on part 2 items

[14.0.7] EXP-205 applies to every part 2 item that is a copy (`xsl:copy`) of a source element. Each carries a declaration for every namespace in scope for its source element that its nearest written ancestors have not declared, outermost declaration first: the Envelope's `xmlns:SOAP-ENV`, then those of the ancestors from the root down, then its own.

- **ItemType edit** (EXP-320): the copy carries them, including `xmlns:SOAP-ENV` and the declarations the root ItemType carries. Its Property items sit inside it, so they add only a declaration of their own (`xmlns:p` on the Property, `xmlns:z` on a child) that no ancestor has written.
- **Field fix** (EXP-340): in scope are the Envelope's, the Form's, the `Relationships`' and the Field's own, written in that order: `xmlns:SOAP-ENV="…" xmlns:i18n="…" xmlns:r="…" xmlns:own="…"`. The comment, `propertytype_id` and the `get` Item below are literal and carry none.
- **Member fix** (EXP-350): the same, after its attributes.
- **Morphae fix** (EXP-351): the wrapper is a literal element and declares nothing, so the Morphae copy carries every namespace in scope, `xmlns:SOAP-ENV` first.
- **View and Form deletes** (EXP-330) are literal elements and carry none.

`ApplyXsl` removes the exact text of the SOAP-ENV declaration everywhere; what becomes of the other declarations is in EXP-205 and `EXP-400` to `EXP-499`.

```xml
<!-- source: Form F1 declares i18n; its Relationships declares r; the Field declares own -->
<!-- output (the Field fix) -->  <Item type="Field" id="FL1" action="edit" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i18n="urn:i18n" xmlns:r="urn:r" xmlns:own="urn:own"><!-- Please note: this AML depends on the "" ItemType. Please make sure it exists before running this. --><propertytype_id><Item type="Property" action="get" select="id"><name></name><source_id type="" keyed_name=""></source_id></Item></propertytype_id></Item>
```

[12.0] Same as 14.0.7.

### EXP-363: Where part 2 writes empty text

[14.0.7] Only the Field fix builds elements from `value-of` (EXP-340), so only there does empty content give the `<x></x>` form of EXP-204: `<name></name>` and `<source_id type="" keyed_name=""></source_id>`. Everything else in part 2 copies or drops: a copied empty element stays `<x />` (the `<column_width />` and `<order_by />` of a fixed Property come from `<column_width></column_width>` in the source), the View and Form deletes carry their values in attributes, and the ItemType edit and the Morphae wrapper are literal. A zero-length CDATA section in the source is the one copied node that gives `<x></x>` (EXP-204).

[12.0] Same as 14.0.7.

## Where the engine's conflict rules decide, part 2

### EXP-370: Priority in part 2

[14.0.7] Part 2 adds many templates for `Item[@type='Property']` and bare element names, and the engine's conflict resolution (EXP-202, ticket 06 X3) decides which applies when several match one node.

- **Priority beats order.** The drop templates with a predicate or a path (`Item[@type='Property'][name='id']`, the conditional element drops, `Item[@type='Variable']/…`, `Relationships[count(*)=0]`, `Item[@type='User']/pwd_is_set_on`; priority 0.5) beat the catch-all `*` (-0.5). The bare names of EXP-311 (priority 0) beat `*` and cannot meet the plain `Item` template, because they match different elements.
- **Equal priority never changes a result.** The only nodes that match several templates of equal priority are Property Items matched by more than one drop template (a keyed Property named `id` is matched by the keyed template and by the `id` template). All of them write nothing, so which one "wins" is not observable. No two templates of equal priority with different results match one node in 14.0.7: the Identity, Method, Member/Morphae, Item Action, RelationshipType and ItemType-under-`related_id` templates differ by `type`, and each property template is fixed by its parent type and element name.
- **Modes are separate.** A node is handled in `fix` mode only where the root template applies it (EXP-300), and a default-mode template never applies to it there. The two `Item[@type='Field']/propertytype_id` templates have the same pattern and priority and live in different modes.

The port can therefore evaluate part 2's templates in any order. A later engine adds a template that does outrank one of these: 14.35's `is_null` drop beats the Method-valued templates of part 1 (ticket 06, X3), and its variant records it.

[12.0] Same as 14.0.7.

[14.35] The statement that "no two templates of equal priority with different results match one node" holds for part 2's own templates, and the `is_null` drop is a later engine's template that outranks part 1 templates (EXP-260). It ties with part 2's 0.5 drop templates too, and wins by order; since both write nothing, no result changes.

## 14.35 additions

### EXP-380: Elements marked `is_null="1"` are dropped

[14.0.7] There is no such rule. An element marked `is_null="1"` is copied by the catch-all (EXP-221) or rewritten by the template that names it, and reaches the file as, for example, `<label is_null="1" />`.

[14.35] The stylesheet has one more template, `export.xsl:454`, in default mode, between the Morphae fix and the catch-all. Its pattern is `node()[@is_null='1'][not(starts-with(name(), 'xp-'))]` and its content is empty. It writes nothing for any element whose `is_null` attribute is exactly the string `1`, unless the element's qualified name starts with the lowercase text `xp-`. The element goes with its attributes, text and descendants (probes `AX1` to `AX12`, with 14.0.7's output beside them).

- **The test.** `is_null` must equal `1` as a string. `0`, `1 ` (trailing space), ` 1` and an empty value do not match, and the element is handled as before (`AX2`). A child's attribute is not looked at: only the element's own. An element that has `is_null="1"` and also text or children loses them (`AX2`: `<label is_null="1">text under null</label>` is dropped).
- **The name exception.** The test is on the qualified name, case-sensitive: `xp-foo` and `xp-bar` stay, with their `is_null="1"`, and so does their text; `XP-baz` and `xpfoo` are dropped (`AX3`). `starts-with` is a prefix test on the name as written, including any namespace prefix.
- **Where it applies.** Wherever default-mode templates run: properties (`label`, `comments`, `method_type`, `classification`), nested Items (an `Item` that is itself marked disappears with its whole subtree, `AX4`), reference properties (a marked `owned_by_id` with its nested Identity, `AX6`; `related_id`, `AX8`), a Field's `propertytype_id` (`AX10`) and, through the default-mode handling of their children, the Property items of the ItemType edit (EXP-324, EXP-395).
- **Not the root Item.** The root Item is handled in `mode="first"` (EXP-212): its attributes are rebuilt, `is_null` is not copied, and the template is not applied to it (`AX5`, `AX9`). The `xsl:copy` Items of part 2 (the ItemType edit, Member and Morphae fixes) are in `mode="fix"` and are not tested either; their children are (`AXF2`, `AXF4`, `AXF8`).
- **Priority.** The template has priority 0.5. It beats the plain `Item` template (0) and the catch-all `*` (-0.5) and ties with every other 0.5 template, where the last one in the stylesheet wins (EXP-202): this one. So it also beats the Identity and Method Item templates, the Identity- and Method-valued properties, the Field `propertytype_id`, the Grid Event `source_id`, the foreign-property references and the `reference` rewrite for a marked element (EXP-260). It does not matter for part 2's drop templates, which write nothing either.
- **What is left.** Nothing, not even an empty text node. A parent whose element children were all dropped has no content from the transform: a `Relationships` that held only dropped Items is written `<Relationships />` (EXP-244). Whitespace text around a dropped element stays (EXP-203).

The server marks a null column `is_null="1"` in a response whose request did not exclude nulls: the ItemType export with its relationships and the items fetched by the explicit relationship trees of the 14.35 requests (`EXP-020` to `EXP-025`). Items fetched with the default select (`*[is_not_null()]`, EXP-023) do not carry such elements. A package exported by 14.35 therefore holds no explicit null where 14.0.7's held one. On import an absent element leaves the column alone, while `is_null="1"` sets it to null. *Which dev items carry the marks is recorded with the 14.35 fixtures (ticket 57); the rule rests on the stylesheet and the probes.*

```xml
<!-- source -->  <Item type="List" id="L1"><name>n</name><label is_null="1"/><comments is_null="1"></comments><xp-foo is_null="1"/><Relationships><Item type="Value" id="V1"><label is_null="1"/><value>v</value></Item><Item type="Value" id="V2" is_null="1"><value>w</value></Item></Relationships></Item>
<!-- 14.0.7 -->  <AML><Item type="List" id="L1" action="add"><name>n</name><label is_null="1" /><comments is_null="1" /><xp-foo is_null="1" /><Relationships><Item type="Value" id="V1" action="add"><label is_null="1" /><value>v</value></Item><Item type="Value" id="V2" action="add"><value>w</value></Item></Relationships></Item></AML>
<!-- 14.35 -->   <AML><Item type="List" id="L1" action="add"><name>n</name><xp-foo is_null="1" /><Relationships><Item type="Value" id="V1" action="add"><value>v</value></Item></Relationships></Item></AML>
```

This is probe `AX17`. Its outputs are shown after the namespace handling of `EXP-400` to `EXP-499`, leaving out the `xmlns:i18n` attribute that 14.35 keeps on the root Item (EXP-410).

### EXP-381: A Property flagged `export_has_translations` counts as modified

[14.0.7] The selection of EXP-322 (a) looks only at the values of the Property's children. Its attributes are not read.

[14.35] Each of the 32 name-and-values selections of EXP-322 (a) gains a last alternative: the Property is selected when its own `export_has_translations` attribute is exactly `1`, whatever its values are. The attribute is on the Property `Item` element, not on a child. Only those 32 selections change. The by-content selection (b), the keyed set K (EXP-321) and the last selection of the template (system names with a non-empty `Relationships`) are as before. Probes:

- a stock `behavior` row has no edit (`AXF1`); the same row with `export_has_translations="1"` gets the ItemType edit, with the row's stock values as the Property edit of EXP-324 (`AXF2`: `where="source_id='' and name='behavior'"`);
- `export_has_translations="0"`, or any other value, leaves the row stock (`AXF3`);
- a flagged system Property whose values deviate is written once, as before (`AXF5`: `team_id`, whose label `Team` is its stock label, flagged, is written as an edit);
- a flagged Property that is not one of the 32 names is an ordinary Property of the ItemType and is not selected (`AXF6`);
- the three dated names (`effective_date`, `release_date`, `superseded_date`) keep their extra condition (the ItemType is versionable) in front of the alternatives, so the flag alone does not select them in a non-versionable ItemType. *From the template; not probed.*

Only the language-resource export sets the attribute: `MarkPropertiesWithTranslationsIfNeeded` adds `export_has_translations="1"` to a Property that has a non-`en` translation, and it does so only when the engine action is `ExportLanguageResourcesOnly` (language-export rules, ticket 54). With the plain export the alternative is never true, so the stylesheet behaves as in 14.0.7.

## Reproduced bugs, part 2

### EXP-390: Interpolated where clauses are not escaped

[14.0.7] The `where` attributes of the View and Form deletes (EXP-330) and of the Property edits (EXP-324) put the id and the name between apostrophes without escaping them. A name that contains `'` ends the string early: `O'Neil` gives `where="name='O'Neil'"`, which the server then rejects or reads as another condition. Only the XML escaping of the attribute is applied. It is reproduced as the engine does it, byte for byte (`AGENTS.md`, rule 7). See `bugs.md`.

[12.0] Same as 14.0.7.

### EXP-391: is_current is compared without order_by

[14.0.7] The row of `is_current` in the stock comparison (EXP-323) has no `order_by` test, where every other row has one. A modified `order_by` of `is_current` alone is never exported, while the same change to `id` is. It is reproduced. See `bugs.md`.

[12.0] Same as 14.0.7.

### EXP-392: Content in a Relationships selects a stock system Property

[14.0.7] A system Property is also exported when it has a `Relationships` child with any child node (EXP-322 (b)). The test counts whitespace, text, comments and processing instructions, though the `Relationships` is dropped as empty (EXP-316) and so carries nothing. A stock `id` Property whose `Relationships` holds `\n` is written as an edit that changes nothing. It is reproduced. See `bugs.md`.

[12.0] Same as 14.0.7.

### EXP-393: System-name tests in part 2 are substring tests

[14.0.7] The tests of EXP-301 that are substring tests find a name that contains `|` as a run of entries. Their effects in part 2:

- a custom Property named `state|itemtype` is not a keyed Property (EXP-321), is selected by (b) when it has any `Relationships` content and then exported as an `edit` of that name (`where=… name='state|itemtype'`); when it is also keyed, it is dropped from the main pass and is in neither K nor M, so **it is lost**;
- a Property named `related_id|sort_order` with a Change Controlled Relationship `source_id` and any `Relationships` content is treated as one of the three Change Controlled Relationship names: it is written with its `id` and `action="add"` (EXP-324), and also stays in the main pass;
- a Field whose `propertytype_id` has the `keyed_name` `state|itemtype` gets a Field fix with empty names (EXP-340).

It is reproduced. See `bugs.md` and EXP-271.

[12.0] Same, except the second bullet: a Property named `related_id|sort_order` with a Change Controlled Relationship `source_id` and any `Relationships` content passes the substring test for a system name and is written as an edit (`action="edit"` and a `where`, EXP-324), with no `id`; it also stays in the main pass. The other two bullets are as in 14.0.7.

### EXP-394: Members and Morphae below the root's own relationships are lost

[14.0.7] The drop template removes every nested Member and Morphae (EXP-240), but the fix pass re-emits only those that are children of the root Item's own `Relationships` (EXP-350, EXP-351). A Member or Morphae anywhere else, such as in the `Relationships` of the ItemType embedded in a RelationshipType's `relationship_id`, or in a nested Item, is written nowhere. It is reproduced. See `bugs.md`.

[12.0] Same as 14.0.7.

### EXP-395: The edit of a modified system Property loses its null label and null default value (bug)

[14.35] The Property items of the ItemType edit are handled in default mode (EXP-300), so the `is_null` drop (EXP-380) removes their `label` and `default_value` children when those are marked `is_null="1"`. A system Property whose label was cleared, for example `team_id` (stock label `Team`) with `<label is_null="1"/>`, deviates from its stock row and is selected (EXP-322 (a)), but its edit says nothing about the label: in 14.0.7 it carried `<label is_null="1" />`, in 14.35 it does not (probe `AXF8`). The same happens to a cleared `default_value`, and to the null label and null default of a keyed Property written with `action="add"` (EXP-321, probe `AXF7`). An import of the package therefore leaves the target's label and default as they are, where the 14.0.7 package would clear them. It is reproduced. See `bugs.md`.

## Template index, part 2

Every template of `export.xsl` that part 1 does not index, in stylesheet order, with the rule that specifies it.

| `export.xsl` | Template | Rule |
|---|---|---|
| 3 | `xsl:output` and its `cdata-section-elements` list | EXP-360 |
| 4 | the `systemProperties` string | EXP-301 |
| 26–47 | follow-up items of the root Item (`mode="first"`) | EXP-214, EXP-352 |
| 27–32 | ItemType and RelationshipType fix selection | EXP-325 |
| 33–41 | View and Form delete items | EXP-330 |
| 42–43 | Field fix selection | EXP-340 |
| 44–47 | Member and Morphae selection | EXP-350, EXP-351 |
| 102–103 | `User/pwd_is_set_on` | EXP-315 |
| 224–256 | Property drops (keyed, system names, dated names) | EXP-310 |
| 289–291 | Variable `value`, `default_value` | EXP-314 |
| 293 | `behavior` | EXP-312 |
| 294–298, 300–319 | bare system elements | EXP-311 |
| 299 | `css` | EXP-312 |
| 320 | `item_behavior` | EXP-312 |
| 322–325 | `generated_type`, `execution_count` | EXP-313 |
| 328 | empty `Relationships` | EXP-316 |
| 331–350 | Field fix (`mode="fix"`) | EXP-340 |
| 352–357 | Field `propertytype_id` fix (never applied) | EXP-300 |
| 359–405 | ItemType edit (`mode="fix"`) | EXP-320 to EXP-323 |
| 408–431 | Property fix (`mode="fix"`) | EXP-324 |
| 433–440 | Member fix (`mode="fix"`) | EXP-350 |
| 442–453 | Morphae fix (`mode="fix"`) | EXP-351 |
