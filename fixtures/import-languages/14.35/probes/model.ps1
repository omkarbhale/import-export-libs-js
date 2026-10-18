# The server model of the 14.0.7 import-run probe (fixtures/import-run/probe/probe.ps1), reused unchanged: a small in-memory
# Aras that answers the requests ImportSolutions makes. What it answers is the probe's model, not evidence of what Aras answers.
. (Join-Path $PSScriptRoot 'stub.ps1')
function Fault-Model($code, $text) { return (Fault ([string]$code) $text) }
function Res($inner) { return (Result $inner) }
function New-World {
    return @{
        rules = @()             # scenario overrides
        packages = @()          # PackageDefinition names the server lists (getSolutions)
        du = @{}                # DatabaseUpgrade name -> @{id; locked}
        dupSeq = 0
        pkgdefs = @{}           # name -> id
        groups = @{}            # name -> id
        elements = @{}          # element id -> @{source; type}
        existing = @{}          # id -> $true for items that exist (ItemExistById, DoesItemAlreadyExist)
        versionable = @{}       # type -> $true
        labels = @{}            # type -> label
        deps = @{}
        missingTypes = @{}
        onRequest = $null
        getMissing = $true      # an unscripted get by id finds nothing
        cnt = @{}
    }
}
function Get-Attr([string] $req, [string] $name) {
    $m = [regex]::Match($req, '^<Item[^>]*?\b' + $name + '="([^"]*)"'); if ($m.Success) { return $m.Groups[1].Value }; return $null
}
function Get-Child([string] $req, [string] $name) {
    $m = [regex]::Match($req, '<' + $name + '>([^<]*)</' + $name + '>'); if ($m.Success) { return $m.Groups[1].Value }; return $null
}
function Model-Respond($w, [string] $req) {
    $type = Get-Attr $req 'type'; $action = Get-Attr $req 'action'
    if ($req -like '*select="name,generation"*') {
        $s = ''
        foreach ($p in $w.packages) { $s += '<Item type="PackageDefinition" id="PD-' + $p.name + '"><name>' + $p.name + '</name>'; if ($p.deps) { $s += '<Relationships>'; foreach ($d in $p.deps) { $s += '<Item type="PackageDependsOn"><name>' + $d + '</name></Item>' }; $s += '</Relationships>' }; $s += '</Item>' }
        if ($w.packages.Count -eq 0) { return (Fault-Model 0 'No items of type PackageDefinition found.') }
        return (Res $s)
    }
    if ($type -eq 'PackageDefinition') {
        $n = Get-Child $req 'name'
        if ($action -eq 'get') { if ($w.pkgdefs.ContainsKey($n)) { return (Res ('<Item type="PackageDefinition" id="' + $w.pkgdefs[$n] + '"><id>' + $w.pkgdefs[$n] + '</id><name>' + $n + '</name></Item>')) }; return (Fault-Model 0 'No items of type PackageDefinition found.') }
        if ($action -eq 'add') { $id = 'PD-' + $n; $w.pkgdefs[$n] = $id; return (Res ('<Item type="PackageDefinition" id="' + $id + '"><id>' + $id + '</id><name>' + $n + '</name></Item>')) }
    }
    if ($type -eq 'DatabaseUpgrade') {
        if ($req -like '*select="locked_by_id"*') {
            $id = Get-Child $req 'id'
            $locked = $false; foreach ($k in $w.du.Keys) { if ($w.du[$k].id -eq $id -and $w.du[$k].locked) { $locked = $true } }
            if ($locked) { return (Res ('<Item type="DatabaseUpgrade" id="' + $id + '"><id>' + $id + '</id><locked_by_id keyed_name="admin">U1</locked_by_id></Item>')) }
            return (Res ('<Item type="DatabaseUpgrade" id="' + $id + '"><id>' + $id + '</id><locked_by_id/></Item>'))
        }
        if ($action -eq 'get') {
            $n = Get-Child $req 'name'
            if ($w.du.ContainsKey($n)) { return (Res ('<Item type="DatabaseUpgrade" id="' + $w.du[$n].id + '"><name>' + $n + '</name></Item>')) }
            return (Fault-Model 0 'No items of type DatabaseUpgrade found.')
        }
        if ($action -eq 'add') { $w.dupSeq++; $n = Get-Child $req 'name'; $id = 'DU' + $w.dupSeq; $w.du[$n] = @{ id = $id; locked = $false }; return (Res ('<Item type="DatabaseUpgrade" id="' + $id + '"/>')) }
        if ($action -eq 'unlock') { return (Res ('<Item type="DatabaseUpgrade" id="' + (Get-Attr $req 'id') + '"/>')) }
        if ($action -eq 'edit') { return (Res ('<Item type="DatabaseUpgrade" id="' + (Get-Attr $req 'id') + '"/>')) }
    }
    if ($type -eq 'PackageDependsOn') {
        if ($action -eq 'get') { $n = Get-Child $req 'name'; $k = (Get-Child $req 'source_id') + '/' + $n; if ($w.deps.ContainsKey($k)) { return (Res ('<Item type="PackageDependsOn" id="' + $w.deps[$k] + '"/>')) }; return (Fault-Model 0 'No items of type PackageDependsOn found.') }
        if ($action -eq 'add') { $n = Get-Child $req 'name'; $k = (Get-Child $req 'source_id') + '/' + $n; $id = 'DEP-' + $n; $w.deps[$k] = $id; return (Res ('<Item type="PackageDependsOn" id="' + $id + '"/>')) }
    }
    if ($type -eq 'PackageReferencedElement') {
        if ($action -eq 'get') { return (Fault-Model 0 'No items of type PackageReferencedElement found.') }
        if ($action -eq 'add') { return (Res '<Item type="PackageReferencedElement" id="PRE1"/>') }
    }
    if ($type -eq 'PackageGroup') {
        $n = Get-Child $req 'name'
        if ($action -eq 'get') { if ($w.groups.ContainsKey($n)) { return (Res ('<Item type="PackageGroup" id="' + $w.groups[$n] + '"/>')) }; return (Fault-Model 0 'No items of type PackageGroup found.') }
        if ($action -eq 'add') { $id = 'PG-' + $n; $w.groups[$n] = $id; return (Res ('<Item type="PackageGroup" id="' + $id + '"/>')) }
    }
    if ($type -eq 'PackageElement') {
        if ($action -eq 'get') { $e = Get-Child $req 'element_id'; if ($w.elements.ContainsKey($e)) { return (Res ('<Item type="PackageElement" id="PE1"><source_id>' + $w.elements[$e].source + '</source_id><element_type>' + $w.elements[$e].type + '</element_type></Item>')) }; return (Fault-Model 0 'No items of type PackageElement found.') }
        if ($action -eq 'add') { return (Res '<Item type="PackageElement" id="PE-new"/>') }
    }
    if ($type -eq 'ItemType' -and $req -like '*select="label"*') {
        $n = Get-Child $req 'name'
        if ($w.labels.ContainsKey($n)) { if ($w.labelShape -eq 'plain') { return (Res ('<Item type="ItemType" id="IT"><label xml:lang="en">' + $w.labels[$n] + '</label></Item>')) }
        if ($w.labelShape -eq 'noLang') { return (Res ('<Item type="ItemType" id="IT"><label>' + $w.labels[$n] + '</label></Item>')) }
        return (Res ('<Item type="ItemType" id="IT"><i18n:label xmlns:i18n="http://www.aras.com/I18N" xml:lang="en">' + $w.labels[$n] + '</i18n:label></Item>')) }
        return (Res '<Item type="ItemType" id="IT"><name>x</name></Item>')
    }
    if ($type -eq 'ItemType' -and $req -like '*select="is_versionable"*') {
        $n = Get-Child $req 'name'
        return (Res ('<Item type="ItemType" id="IT"><is_versionable>' + $(if ($w.versionable.ContainsKey($n)) { '1' } else { '0' }) + '</is_versionable></Item>'))
    }
    if ($req -like '*select="config_id"*') { return (Res ('<Item type="' + $type + '" id="' + (Get-Child $req 'id') + '"><config_id>CFG-' + (Get-Child $req 'id') + '</config_id></Item>')) }
    if ($action -eq 'get') {
        $id = Get-Child $req 'id'
        if ($id) {
            if ($w.existing.ContainsKey($id)) { return (Res ('<Item type="' + $type + '" id="' + $id + '"><id>' + $id + '</id></Item>')) }
            if ($w.getMissing) { return (Fault-Model 0 ('No items of type ' + $type + ' found.')) }
        }
    }
    return (Res ('<Item type="' + $type + '" id="GEN"/>'))
}

