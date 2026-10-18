# The export transform, part 1: root, Items and references

Every exported item goes through one XSLT 1.0 stylesheet before it is written: `export.xsl`, an embedded resource of `Libs.dll`. This document re-expresses it as rules, in the order a reader needs them: the model first (loading, template selection, defaults, empty text, namespaces), then the root wrapper, then each family of templates. The TypeScript port implements these rules as code, not as XSLT (round 1, Q2; wayfinder ticket 31).

**Part 2** (`EXP-300` to `EXP-399`, a later ticket) continues the same stylesheet with the `mode="fix"` passes (the ItemType edit that carries keyed and modified system properties, the View/Form delete items, the Field fixes, Members and Morphae re-emitted at the end), the system-element drop list, the Variable and User drops and the `xsl:output` CDATA element list. Where a part 1 rule hands over to one of those, it says so. The SOAP-ENV string strip and the reload of the result belong to the post-processing document (`EXP-400` to `EXP-499`, ticket 15).

Sources:

- the 14.0.7 decompile of `Libs.dll` (`.decomp/14.0.7/`, never committed): `CItemHelper::ApplyXsl`, `GetXslTransform` and `GetManifestResourceStream`, and the stylesheet resource `Aras.Tools.SolutionUpgrade.export.xsl` that ILSpy extracts next to the project. Rules cite the stylesheet by template, not by quoting it, and give its line numbers as `export.xsl:N`.
- probes of that stylesheet, run under `XslCompiledTransform` on Windows PowerShell 5.1 with the same loading and invocation as `ApplyXsl` (EXP-200, EXP-201), on hand-written response documents. The worked examples below are reduced from those runs and show the transform's raw output. Wayfinder ticket 68 turns such probes into recorded fixtures, and tickets 31 and 32 replay them.
- `data/libsjs-06/report.md` (rules X1 to X7 for `XslCompiledTransform`) and `data/libsjs-08/report.md` (finding F6, the empty-text correction to X6).

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

### EXP-201: Input and output of the transform

[14.0.7] `ApplyXsl` transforms the whole document (its document node, not an element) into a `StringWriter` with `InvariantCulture`, then removes the SOAP-ENV declaration string from the text and reloads the text into the same `XmlDocument` with `LoadXml` (post-processing, `EXP-400` to `EXP-499`).

- An exception raised while loading or running the transform is wrapped in a `CItemException` with faultcode `-1`, the original message followed by ` Error of  applying export.xsl.` (the message has two spaces), and the original exception as its cause.
- The reload is outside that handler. An `XmlException` from it (an empty output, several root elements, `]]>` in character data) propagates to `CExportItems.Export`, which turns it into a `CItemException` whose message is the exception's message followed by ` Can't export item.` The item then fails as a whole (`EXP-500` to `EXP-599`).
- The output method is `xml` with no declaration and no indentation. The text writer, the escaping of text and attributes, the `\r\n` line breaks and the `cdata-section-elements` list are ticket 06's rules X4 and X6; the list itself is part 2.

### EXP-202: Template selection

[14.0.7] A node is handled by the matching template of highest priority. The stylesheet declares no priorities, so the XSLT 1.0 defaults apply: a pattern that is a single bare name (`Item`, `Result`, `id`) has priority 0; `*` has -0.5; any pattern with a predicate or more than one step has 0.5. When two templates of the same priority match, `XslCompiledTransform` silently takes the one that comes last in the stylesheet (ticket 06, X3).

In default mode the stylesheet has, for elements:

| Priority | Templates |
|---|---|
| 0.5 | every template whose pattern has a predicate or a path: the Envelope, Body, Identity, Method, Member/Morphae, Item Action, RelationshipType, related_id, Field `propertytype_id`, Grid Event `source_id`, FileSelectorTemplate `reference`, foreign-property, Method-valued, Identity-valued and (part 2) Property, Variable, `behavior`, `css`, `item_behavior`, `pwd_is_set_on` and `Relationships` templates |
| 0 | the plain `Item` template, `Result`, and the bare element-name templates of the drop list (part 2) |
| -0.5 | the catch-all `*` template, which copies an element |

So a specific template always beats the plain `Item` template and the catch-all, by priority and not by order. No two templates of different behaviour tie in 14.0.7 (EXP-260). The root Item is not matched in default mode at all: the `mode="first"` template handles it (EXP-212).

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

### EXP-204: "Empty text emitted" versus "no content"

[14.0.7] An output element is written `<x></x>` when the transform wrote a text node into it, even an empty one, and `<x />` when it received no text node and no child. Ticket 08 (finding F6) corrected ticket 06's X6 this way, and the reloaded document keeps the form (ticket 06, W3).

What writes a text node, even when its value is empty:

- `value-of` always does. So each of these gives `<x></x>` when its value is empty: the `name` of a Method reference, the `keyed_name`, `source_id` and `name` of a foreign-property or Grid Event reference, the Identity content of an Identity-valued property, the id that replaces a nested ItemType under `related_id`, and the id kept inside `propertytype_id`.
- A nested Identity Item that is not a system identity writes its id as text (EXP-230). When that id is empty, its container still receives a text node.

What writes none: copying an element whose source element is empty (`<x/>` and `<x></x>` both give `<x />`), copying attributes, and any element whose children were all dropped or produced no text.

```xml
<!-- source -->  <Item type="Foo" id="1"><a><Item type="Identity"><keyed_name>Acme</keyed_name></Item></a><b><Item type="Member" id="M"/></b><c></c></Item>
<!-- output -->  <AML><Item type="Foo" id="1" action="add"><a></a><b /><c /></Item></AML>
```

The port models this with an explicit flag on a written element: "received text". The item file writer (`EXP-400` to `EXP-499`) then prints `<x></x>` for a childless element with the flag and `<x />` without.

### EXP-205: Namespace declarations on copied elements

[14.0.7] `xsl:copy` copies, with the element, every namespace in scope for its source element (ticket 06, X1). An output element created by `xsl:copy` therefore carries an `xmlns:` declaration for each in-scope namespace that its nearest output ancestors have not already declared with the same URI, after its attributes. Elements written as literal result elements (`AML`, the generated `get` Items, the View/Form delete items) carry none.

In part 1 every copied element sits below the root Item copy, so:

- the root Item carries `xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"` (the Envelope's declaration), then any other namespace in scope for it;
- a nested copied element carries a declaration only for a namespace that the source declares on or below it and that no output ancestor has;
- the property elements and Items the transform builds itself carry none.

`ApplyXsl` then deletes the exact text of the SOAP-ENV declaration (ticket 06, X2; `EXP-400` to `EXP-499`). Every other declaration survives into the reloaded document, until `RemoveNamespaceNodes` removes prefixed attributes from `Item` elements only. So a declaration on a nested non-Item element stays in the exported file.

```xml
<!-- source: Envelope declares SOAP-ENV; the root Item declares i18n; a nested Item declares foo; <n> declares bar -->
<!-- output -->  <AML><Item type="A" id="1" action="add" xmlns:SOAP-ENV="…" xmlns:i18n="http://www.aras.com/I18N"><label i18n:x="1" xml:lang="en">l</label><Relationships><Item type="B" id="2" action="add" xmlns:foo="urn:foo"><n xmlns:bar="urn:bar">v</n></Item></Relationships></Item></AML>
```

## The root wrapper

### EXP-210: Envelope, Body and Result

[14.0.7] The document node is handled by a template that visits only its `Envelope` child. An `Envelope` is any element whose local name is `Envelope`, a `Body` any child of it whose local name is `Body`, whatever their namespace or prefix. `Result` is different: only a child of `Body` named `Result` with no namespace is visited. The root Items are the `Item` children of that `Result`.

Any other shape writes nothing: a document whose root element is not an `Envelope`, a `Body` without a `Result`, a prefixed `Result` (`SOAP-ENV:Result`), or a `Result` without Item children. The empty output then fails the reload (EXP-201), and the item fails with `Root element is missing. Can't export item.`

### EXP-211: One AML wrapper per root Item

[14.0.7] Each root Item is written inside its own `<AML>` element, with the root Item copy first and the part 2 follow-up items after it (EXP-214). A response with two root Items therefore writes two `AML` elements in a row, and the reload fails with `There are multiple root elements.` Exports request one item by id, so a normal `Result` holds one Item.

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

### EXP-213: The root Item is exempt from the nested-Item templates

[14.0.7] The templates for nested Items (EXP-220 and the Identity, Method, Member/Morphae, Item Action, RelationshipType and ItemType families below) are never applied to the root Item, because the root is handled by its own template and its children are visited, not the root itself. A root Identity, Method, Member, Morphae, Item Action or RelationshipType is therefore exported in full, as an ordinary item with `action="add"`.

The Identity and Method templates carry a second guard (EXP-230, EXP-235): they do not match an Item whose parent is an element named `Result`. That matters only for an Item below a nested element called `Result`. The `Result` template matches that element too (EXP-210), so such an Item is handled like a root Item: wrapped in its own `<AML>` with the root rules of EXP-212, inside the surrounding element. A response does not contain one.

Property-level templates still apply to the root's own children: a root `View` has its `role` and `method` rewritten (EXP-231, EXP-236), a root `Report` its `method`, a root `Field` its `propertytype_id` (EXP-252), and a root `Property` its foreign-property references and Grid Events (EXP-250, EXP-251, EXP-253).

### EXP-214: What follows the root Item in the AML

[14.0.7] After the root Item copy, the root template writes, in this order, the items that part 2 specifies. Each condition is evaluated on the source tree:

1. for a root `ItemType`, the ItemType edit item (the `mode="fix"` pass of the root Item); for a root `RelationshipType`, the same pass on its embedded `relationship_id/Item` of type `ItemType`;
2. the View and Form `delete` items, in two cases: the root is an `ItemType` with no `View` among its relationships, or the root has a `relationship_id` child holding an Item (a RelationshipType after ticket 12's rewrite) whose own relationships have no `View`; the two tests are independent, so both can fire;
3. the Field fix items: for every `Field` Item anywhere in the source tree below the document, each whose `propertytype_id` `keyed_name` is a system property name;
4. the Member fix items, one per `Member` Item among the root's relationships;
5. the Morphae fix items, one per `Morphae` Item among the root's relationships.

Members and Morphae are dropped from their place in the relationship list (EXP-240) so that these last two groups can add them after the Items they refer to.

## Items and elements

### EXP-220: A nested Item

[14.0.7] A nested Item that no more specific template takes (the plain `Item` template, priority 0) is copied with exactly three attributes, in this order: `type` and `id` if present, then `action="add"`. Every other attribute, including `keyed_name`, `is_null`, `dependencyLevel` and a source `action`, is dropped. Its children are handled in default mode.

```xml
<!-- source -->  <Relationships><Item type="B" id="2" action="get" keyed_name="kb" is_null="0" dependencyLevel="9" extra="x"><name>b</name></Item><Item id="3"><name>c</name></Item></Relationships>
<!-- output -->  <Relationships><Item type="B" id="2" action="add"><name>b</name></Item><Item id="3" action="add"><name>c</name></Item></Relationships>
```

### EXP-221: Every other element

[14.0.7] An element no template matches (the catch-all `*`, priority -0.5) is copied with all its attributes, including `is_null`, `keyed_name`, `type`, `xml:lang` and prefixed attributes, and its children are handled in default mode. Part 2's drop templates beat this rule for the system elements and the empty `Relationships`.

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

## Methods

### EXP-235: A nested Method Item

[14.0.7] A nested `Item` of type `Method` (and not a child of an element named `Result`) becomes `<Item type="Method" action="get" select="id"><name>NAME</name></Item>`, where NAME is the string-value of its first `name` child. Methods are versionable, so an import finds one by name. Nothing else of the Item is kept, not its code, attributes or relationships. A Method without a `name` gives `<name></name>`.

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

## Dropped Items

### EXP-240: Members and Morphae are dropped in place

[14.0.7] A nested `Item` of type `Member` or `Morphae` writes nothing where it stands. Part 2 re-emits each one at the end of the AML (EXP-214). A root Member or Morphae is exported normally (EXP-213).

### EXP-241: Item Actions for "SolutionConfig Export" are dropped

[14.0.7] A nested `Item` of type `Item Action` is dropped when it has a `related_id` child whose `keyed_name` attribute is exactly `SolutionConfig Export`. The test is on the attribute of any `related_id` child; an Item Action whose `related_id` holds an expanded Action Item without that attribute, or whose keyed name differs in case, is kept.

### EXP-242: RelationshipTypes are dropped from ItemType exports

[14.0.7] A nested `Item` of type `RelationshipType` is dropped when it is a child of the `Relationships` element of an `Item` of type `ItemType`. That ItemType can be the root or one nested anywhere, such as the one embedded in `relationship_id`. A RelationshipType anywhere else (under another type, or in a non-`Relationships` element) is copied as an Item (EXP-220). The ItemType export carries its relationships' types in another way (`EXP-100` to `EXP-199`).

### EXP-243: An ItemType under related_id collapses to its id

[14.0.7] An `Item` of type `ItemType` whose parent is an element named `related_id` is replaced by the text of its `id` attribute. Nothing else of the Item is kept. The `related_id` element itself is copied normally, with its attributes, so `<related_id keyed_name="Part" type="ItemType">` keeps the id as its text. Without an `id` the element is `<related_id></related_id>` (EXP-204); several ItemTypes in one `related_id` have their ids concatenated.

An ItemType in any other property (`source_id`, `relationship_id`) is not collapsed. The one embedded in a RelationshipType's `relationship_id` is exported in full, as a nested Item (EXP-220), together with its own follow-up items from part 2.

```xml
<!-- source -->  <Item type="Bar" id="B1"><related_id keyed_name="Part" type="ItemType"><Item type="ItemType" id="IT9" keyed_name="Part"><name>Part</name></Item></related_id></Item><Item type="Bar" id="B6"><source_id keyed_name="Part" type="ItemType"><Item type="ItemType" id="IT7"><name>Part</name></Item></source_id></Item>
<!-- output -->  <Item type="Bar" id="B1" action="add"><related_id keyed_name="Part" type="ItemType">IT9</related_id></Item><Item type="Bar" id="B6" action="add"><source_id keyed_name="Part" type="ItemType"><Item type="ItemType" id="IT7" action="add"><name>Part</name></Item></source_id></Item>
```

### EXP-244: Containers keep their place

[14.0.7] Dropping a nested Item removes only the Item. Its `Relationships` element stays, so a `Relationships` whose only children were dropped is written `<Relationships />`, and any whitespace-only text around the dropped Item stays. Part 2's rule that drops an empty `Relationships` tests the source (no element children, whitespace text allowed), not the output, so it never removes such a leftover. What `RemoveEmptyRelationships` does with it is specified by `EXP-400` to `EXP-499`.

## References

### EXP-250: The data source of a foreign property

[14.0.7] In an `Item` of type `Property` that has a `data_type` child equal to `foreign`, the `data_source` element is replaced by `<data_source><Item type="Property" action="get" select="id"><name>NAME</name><source_id>SRC</source_id></Item></data_source>`. The element's own attributes and text are dropped.

- NAME is the string-value of the first `name` child of the first sibling Property Item whose `id` child equals the foreign property's `data_source` text. A sibling is an `Item` of type `Property` with the same parent as the foreign property: its `Relationships` element, or the `Result` for a root Property, which can then find itself. The property's `id` is the element `id`, not the attribute. With no match NAME is empty.
- SRC is the string-value of the foreign property's own first `source_id` child (empty when absent).

Both children are always written, with empty text if need be (EXP-204). A `data_source` of a Property that is not foreign is copied unchanged.

### EXP-251: The foreign property of a foreign property

[14.0.7] In the same kind of Property, the `foreign_property` element is replaced by `<foreign_property><Item type="Property" action="get" select="id"><keyed_name>KN</keyed_name><source_id><Item type="ItemType" action="get" select="id"><name>IT</name></Item></source_id></Item></foreign_property>`. The element's own attributes and text are dropped.

- KN is the element's `keyed_name` attribute (empty when absent).
- IT is the `name` attribute of the `data_source` child of the same sibling Property that EXP-250 finds (the item property the foreign one reads through), that is, the name of the ItemType it points to. It is empty without a match, or when that `data_source` has no `name` attribute.

```xml
<!-- source: Property PB (foreign) beside Property PA (item, data_source name="Parent") -->
<!-- output -->  <data_source><Item type="Property" action="get" select="id"><name>parent</name><source_id>IT1</source_id></Item></data_source><foreign_property><Item type="Property" action="get" select="id"><keyed_name>name</keyed_name><source_id><Item type="ItemType" action="get" select="id"><name>Parent</name></Item></source_id></Item></foreign_property>
```

### EXP-252: The propertytype_id of a Field

[14.0.7] For a `propertytype_id` that is a child of an `Item` of type `Field`:

- **Dropped** (nothing written) when the string-value of the `name` child of its first `Item` child of type `Property` is one of the system property names: `behavior`, `classification`, `config_id`, `created_by_id`, `created_on`, `css`, `current_state`, `generation`, `history_id`, `id`, `is_current`, `is_released`, `keyed_name`, `release_date`, `effective_date`, `locked_by_id`, `major_rev`, `managed_by_id`, `minor_rev`, `modified_by_id`, `modified_on`, `new_version`, `not_lockable`, `owned_by_id`, `permission_id`, `related_id`, `sort_order`, `source_id`, `state`, `itemtype`, `superseded_date`, `team_id`. The test is a substring test (EXP-271); with no such Item child the name is empty and nothing is dropped.
- Otherwise the element is copied with its attributes, and its content is the element's string-value when it has no `Item` child, else the first `id` attribute found among its `Item` children (of any type), which writes `<propertytype_id></propertytype_id>` when there is none (EXP-204).

The Field itself stays in the AML either way. The fix pass of part 2 selects Fields by the `keyed_name` attribute of `propertytype_id`, not by this embedded Property, so the two can disagree: a Field whose attribute names a system property but that has no embedded Property keeps its `propertytype_id` and also gets a fix item with empty names.

```xml
<!-- source -->  <Item type="Field" id="FL1"><propertytype_id keyed_name="name" type="Property"><Item type="Property" id="PR1"><name>name</name></Item></propertytype_id></Item><Item type="Field" id="FL2"><propertytype_id keyed_name="id" type="Property"><Item type="Property" id="PR2"><name>id</name></Item></propertytype_id></Item>
<!-- output -->  <Item type="Field" id="FL1" action="add"><propertytype_id keyed_name="name" type="Property">PR1</propertytype_id></Item><Item type="Field" id="FL2" action="add" />
```

### EXP-253: The source_id of a Grid Event on a system property

[14.0.7] For a `source_id` that is a child of an `Item` of type `Grid Event` that is a child of the `Relationships` of an `Item` of type `Property`, let NAME be the string-value of that Property's first `name` child:

- when NAME is a system property name (the list of EXP-252, substring test, EXP-271) the element is replaced by `<source_id><Item type="Property" action="get" select="id"><name>NAME</name><source_id>SRC</source_id></Item></source_id>`, with SRC the string-value of the Property's own first `source_id` child (empty when absent). The element's attributes and text are dropped;
- otherwise the element is copied with its attributes and its children are handled in default mode.

A system property is itself dropped from its place by part 2's Property drop list and re-emitted by the ItemType edit item, whose pass visits the Property's relationships in default mode. So this rule is what turns that Grid Event's `source_id` into the `get` there. For a root Property it applies in the main pass. A `source_id` under any other parent, or under a Grid Event of a Property without a system name, is not changed.

```xml
<!-- source -->  <Item type="Property" id="P1"><name>state</name><source_id keyed_name="T" type="ItemType">IT1</source_id><Relationships><Item type="Grid Event" id="GE1"><source_id keyed_name="state" type="Property">P1</source_id></Item></Relationships></Item>   (root Property)
<!-- output -->  <AML><Item type="Property" id="P1" action="add"><name>state</name><source_id keyed_name="T" type="ItemType">IT1</source_id><Relationships><Item type="Grid Event" id="GE1" action="add"><source_id><Item type="Property" action="get" select="id"><name>state</name><source_id>IT1</source_id></Item></source_id></Item></Relationships></Item></AML>
```

### EXP-254: The reference of a FileSelectorTemplate is written as CDATA

[14.0.7] A `reference` element is rewritten when its path from an ItemType is exactly `Item[ItemType]/Relationships/Item[DiscussionTemplate]/Relationships/Item[FeedTemplate]/Relationships/Item[FileSelectorTemplate]/reference`, with the ItemType at any depth (the root, or one nested). The element is copied without its attributes, and its content is `<![CDATA[`, the element's string-value, `]]>`, all three written with escaping disabled. The value reaches the output raw: `<`, `&` and quotes unescaped, an entity such as `&amp;amp;` in the source (the text `&amp;`) as `&amp;` inside the CDATA, and line breaks as `\r\n`. An empty `reference` gives `<reference><![CDATA[]]></reference>`.

A `reference` anywhere else on that path (a FeedTemplate directly under the ItemType, a root that is not an ItemType) is copied unchanged and escaped like any text. The `]]>` inside the value is not split (EXP-270).

```xml
<!-- source -->  <reference a="1">&lt;b&gt;x&lt;/b&gt; &amp;amp; "q"</reference>
<!-- output -->  <reference><![CDATA[<b>x</b> &amp; "q"]]></reference>
```

## Where the engine's conflict rules decide

### EXP-260: Priority, not order, decides every part 1 overlap

[14.0.7] Several part 1 templates can match the same node and are told apart by priority (EXP-202):

- every specific Item template (Identity, Method, Member/Morphae, Item Action, RelationshipType, ItemType under `related_id`; priority 0.5) beats the plain `Item` template (0);
- every property template (EXP-231, EXP-236, EXP-250 to EXP-254) beats the catch-all `*` (-0.5), and so do the Envelope, Body and the drop templates for elements they name;
- `Result` (0) beats `*`, and the Envelope and Body templates (0.5) beat it for those two elements.

No two part 1 templates of the same priority match one node. The Identity, Method and the Member/Morphae templates differ by `type`; each property template is fixed by the pair (parent Item type, element name), and no two share one; and no part 1 element name appears in the drop lists of part 2. So the rule "the later template wins at equal priority" never changes a part 1 result in 14.0.7. It does matter in part 2, where the Property drop templates overlap one another (all of them write nothing). Later engines add a template that beats a part 1 one (ticket 06, X3, for 14.35's `is_null` drop), which their variants record.

A mode never falls back to another mode's templates: the default-mode templates of this document handle only what `apply-templates` visits in default mode.

## Reproduced bugs

### EXP-270: A `]]>` in a FileSelectorTemplate reference fails the whole item

[14.0.7] The `reference` rewrite (EXP-254) writes the value raw between `<![CDATA[` and `]]>`, so a value that contains `]]>` ends the CDATA early and the remaining text is malformed. The reload then throws `XmlException` (`']]>' is not allowed in character data.`), and the item fails with `Can't export item.` (EXP-201). It is reproduced, with the same message. See `bugs.md`.

### EXP-271: Identity and system-property membership tests are substring tests

[14.0.7] The tests of EXP-230 (six system identities), EXP-252 and EXP-253 (the system property names) look the `|`-delimited name up inside one long `|`-delimited string. A name that contains `|` can therefore match as a run of several entries, such as the `keyed_name` `World|Creator`, which exports as a system Identity `get` named `World|Creator`, and the property name `state|itemtype`. A name that is a single exact entry matches as intended. It is reproduced as the engine does it. See `bugs.md`.

### EXP-272: A null Method-valued property exports as a Method `get` with an empty name

[14.0.7] A Method-valued property (EXP-236) without a `keyed_name` attribute, including a null one such as `<method is_null="1"/>`, is exported as a `get` of a Method with an empty `name`. That reference cannot be resolved at import. It is reproduced. See `bugs.md`; ticket 06 (X3) found that 14.35's `is_null` drop removes these elements instead, and the 14.35 variant records it.

## Template index

Every part 1 template of `export.xsl`, in stylesheet order, with the rule that specifies it. Part 2 owns the templates not listed.

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
