import { describe, expect, it } from "vitest";
import { loadXml } from "../xml/index.js";
import { STOCK_ROWS } from "./system-properties.js";
import { SYSTEM_PROPERTIES } from "./system-names.js";
import { transformExport } from "./transform.js";

const NS = 'xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"';

/** The transform's text for the given Items, with the SOAP-ENV declaration removed as `ApplyXsl` does. */
function transform(items: string): string {
  const doc = loadXml(`<SOAP-ENV:Envelope ${NS}><SOAP-ENV:Body><Result>${items}</Result></SOAP-ENV:Body></SOAP-ENV:Envelope>`, {
    preserveWhitespace: true,
  });
  return transformExport(doc).replaceAll(` ${NS}`, "");
}

describe("the stock table (EXP-323)", () => {
  it("has a row for each of the 32 system properties", () => {
    expect(Object.keys(STOCK_ROWS).sort()).toEqual(SYSTEM_PROPERTIES.split("|").filter(Boolean).sort());
    expect(Object.values(STOCK_ROWS).filter((row) => row.versionable)).toHaveLength(3);
  });
});

describe("the follow-up items of the root Item (EXP-214, EXP-352)", () => {
  it("drops a Property and re-emits keyed and modified ones in the ItemType edit, keyed first (EXP-310, EXP-320)", () => {
    const out = transform(
      '<Item type="ItemType" id="IT1"><name>Foo</name><Relationships>' +
        '<Item type="Property" id="P1"><name>behavior</name><label is_null="1"/><data_type>list</data_type><stored_length>64</stored_length><column_alignment>left</column_alignment><is_hidden>1</is_hidden><is_hidden2>1</is_hidden2><column_width></column_width><readonly>1</readonly><is_keyed>0</is_keyed><order_by></order_by></Item>' +
        '<Item type="Property" id="P2"><name>mykey</name><is_keyed>1</is_keyed></Item></Relationships></Item>',
    );
    expect(out).toBe(
      '<AML><Item type="ItemType" id="IT1" action="add"><name>Foo</name><Relationships /></Item>' +
        '<Item type="ItemType" id="IT1" action="edit"><Relationships><Item type="Property" id="P2" action="add"><name>mykey</name><is_keyed>1</is_keyed></Item>' +
        '<Item type="Property" action="edit" where="source_id=\'\' and name=\'behavior\'"><name>behavior</name><label is_null="1" /><data_type>list</data_type><stored_length>64</stored_length><column_alignment>left</column_alignment><is_hidden>1</is_hidden><is_hidden2>1</is_hidden2><column_width /><readonly>1</readonly><is_keyed>0</is_keyed><order_by /></Item></Relationships></Item>' +
        '<Item type="View" action="delete" where="source_id=\'IT1\'" /><Item type="Form" action="delete" where="name=\'Foo\'" /></AML>',
    );
  });

  it("writes the where clauses as they are, apart from the attribute escaping (EXP-330, EXP-390)", () => {
    expect(transform('<Item type="ItemType" id="I&amp;D"><name>O\'Neil "x"</name></Item>')).toBe(
      '<AML><Item type="ItemType" id="I&amp;D" action="add"><name>O\'Neil "x"</name></Item><Item type="View" action="delete" where="source_id=\'I&amp;D\'" /><Item type="Form" action="delete" where="name=\'O\'Neil &quot;x&quot;\'" /></AML>',
    );
  });

  it("writes a Field fix with a comment and empty-text elements as <x></x> (EXP-340, EXP-363)", () => {
    expect(
      transform(
        '<Item type="Form" id="FO1"><Relationships><Item type="Field" id="FL2"><name>fm</name><propertytype_id keyed_name="id" type="Property"><Item type="Property" id="PR2"><name>id</name><source_id keyed_name="Part" type="ItemType">IT1</source_id></Item></propertytype_id></Item><Item type="Field" id="FL3"><propertytype_id keyed_name="id"/></Item></Relationships></Item>',
      ),
    ).toBe(
      '<AML><Item type="Form" id="FO1" action="add"><Relationships><Item type="Field" id="FL2" action="add"><name>fm</name></Item><Item type="Field" id="FL3" action="add"><propertytype_id keyed_name="id"></propertytype_id></Item></Relationships></Item>' +
        '<Item type="Field" id="FL2" action="edit"><!-- Please note: this AML depends on the "Part" ItemType. Please make sure it exists before running this. --><propertytype_id><Item type="Property" action="get" select="id"><name>id</name><source_id type="ItemType" keyed_name="Part">IT1</source_id></Item></propertytype_id></Item>' +
        '<Item type="Field" id="FL3" action="edit"><!-- Please note: this AML depends on the "" ItemType. Please make sure it exists before running this. --><propertytype_id><Item type="Property" action="get" select="id"><name></name><source_id type="" keyed_name=""></source_id></Item></propertytype_id></Item></AML>',
    );
  });

  it("writes the Members, then the Morphae each in an ItemType edit, after the other items (EXP-350, EXP-351, EXP-352)", () => {
    expect(
      transform(
        '<Item type="Foo" id="F1"><Relationships><Item type="Morphae" id="MO1"/><Item type="Member" id="M1"/><Item type="Morphae" id="MO2"/><Item type="Member" id="M2"/></Relationships></Item>',
      ),
    ).toBe(
      '<AML><Item type="Foo" id="F1" action="add"><Relationships /></Item><Item type="Member" id="M1" action="add" /><Item type="Member" id="M2" action="add" />' +
        '<Item type="ItemType" id="F1" action="edit"><Relationships><Item type="Morphae" id="MO1" action="add" /></Relationships></Item>' +
        '<Item type="ItemType" id="F1" action="edit"><Relationships><Item type="Morphae" id="MO2" action="add" /></Relationships></Item></AML>',
    );
  });
});

describe("the drops (EXP-311 to EXP-316)", () => {
  it("drops system elements wherever they sit and empty Relationships (EXP-311, EXP-316)", () => {
    expect(
      transform('<Item type="Foo" id="1"><id>i</id><config_id>c</config_id><x><state>s</state></x><sort_order>128</sort_order><Relationships/></Item>'),
    ).toBe('<AML><Item type="Foo" id="1" action="add"><x /><sort_order>128</sort_order></Item></AML>');
  });

  it("drops behavior, css and item_behavior only for some parents (EXP-312)", () => {
    expect(transform('<Item type="Foo" id="1"><behavior>b</behavior><css>c</css></Item>')).toBe('<AML><Item type="Foo" id="1" action="add" /></AML>');
    expect(transform('<Item type="RelationshipType" id="1"><behavior>b</behavior></Item>')).toBe(
      '<AML><Item type="RelationshipType" id="1" action="add"><behavior>b</behavior></Item></AML>',
    );
    expect(transform('<Item type="Field" id="1"><css>c</css></Item>')).toBe('<AML><Item type="Field" id="1" action="add"><css>c</css></Item></AML>');
    expect(
      transform('<Item type="Property" id="1"><data_type>list</data_type><item_behavior>b</item_behavior></Item>'),
    ).toBe('<AML><Item type="Property" id="1" action="add"><data_type>list</data_type></Item></AML>');
  });

  it("trims a Variable's value and default_value (EXP-314)", () => {
    expect(transform('<Item type="Variable" id="1"><value>x</value><default_value>x</default_value></Item>')).toBe(
      '<AML><Item type="Variable" id="1" action="add"><default_value>x</default_value></Item></AML>',
    );
    expect(transform('<Item type="Variable" id="1"><value>a<![CDATA[b]]></value><default_value>ab</default_value></Item>')).toBe(
      '<AML><Item type="Variable" id="1" action="add"><default_value>ab</default_value></Item></AML>',
    );
    // a comment ends a text node, so `a` and `b` are two and neither equals `ab`
    expect(transform('<Item type="Variable" id="1"><value>a<!--c-->b</value><default_value>ab</default_value></Item>')).toBe(
      '<AML><Item type="Variable" id="1" action="add"><value>ab</value><default_value>ab</default_value></Item></AML>',
    );
  });

  it("drops pwd_is_set_on of a User only (EXP-315)", () => {
    expect(transform('<Item type="User" id="1"><pwd_is_set_on>d</pwd_is_set_on></Item>')).toBe('<AML><Item type="User" id="1" action="add" /></AML>');
    expect(transform('<Item type="Foo" id="1"><pwd_is_set_on>d</pwd_is_set_on></Item>')).toBe(
      '<AML><Item type="Foo" id="1" action="add"><pwd_is_set_on>d</pwd_is_set_on></Item></AML>',
    );
  });
});
