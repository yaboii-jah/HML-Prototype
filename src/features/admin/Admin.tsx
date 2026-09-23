"use client";

import { useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Field, InlineError, PageHeader } from "@/src/components/ui/Primitives";
import { dateText } from "@/src/domain/format";

export function Admin() {
  const { snapshot: state, run } = useDemo();
  const [error, setError] = useState("");
  if (!state) return null;

  const submit = async (event: FormEvent<HTMLFormElement>, command: "assignment" | "category" | "supplier" | "newSupplier", id?: string) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = command === "assignment"
      ? { type: "updateAssignment" as const, siteId: id!, manager: String(form.get("manager")), personnel: String(form.get("personnel")) }
      : command === "category"
        ? { type: "addCategory" as const, name: String(form.get("name")) }
        : command === "supplier"
          ? { type: "updateSupplier" as const, id: id!, contact: String(form.get("contact")), accreditation: String(form.get("accreditation")) }
          : { type: "addSupplier" as const, name: String(form.get("name")), location: String(form.get("location")), contact: String(form.get("contact")), accreditation: String(form.get("accreditation")) };
    const result = await run(payload);
    if (result.ok) {
      setError("");
      if (command === "category" || command === "newSupplier") formElement.reset();
    } else setError(result.message);
  };

  return <>
    <PageHeader eyebrow="WORKSPACE SETTINGS" title="Administration" description="Manage project assignments, supplier references, and categories."/>
    <div className="content-grid">
      <section className="panel">
        <h2 className="panel-title">Project assignments</h2>
        {state.sites.map(site => <form className="admin-row" key={site.id} onSubmit={event => void submit(event, "assignment", site.id)}>
          <h3>{site.name}</h3>
          <div className="form-grid">
            <Field label="Project Manager"><input name="manager" defaultValue={site.manager}/></Field>
            <Field label="Site Personnel"><input name="personnel" defaultValue={site.personnel}/></Field>
          </div>
          {state.role === "Administrator" && <button className="button secondary">Save assignment</button>}
        </form>)}
      </section>
      <section className="panel">
        <h2 className="panel-title">Categories</h2>
        <div className="chip-list">{state.categories.map(category => <span className="category-chip" key={category}>{category}</span>)}</div>
        {state.role === "Administrator" && <form className="subform" onSubmit={event => void submit(event, "category")}>
          <Field label="New category"><input name="name" required/></Field>
          <button className="button secondary">Add category</button>
        </form>}
      </section>
    </div>
    <section className="panel">
      <h2 className="panel-title">Supplier references</h2>
      <div className="admin-supplier-grid">{state.suppliers.map(supplier => <form className="admin-row" key={supplier.id} onSubmit={event => void submit(event, "supplier", supplier.id)}>
        <h3>{supplier.name}</h3><small>{supplier.location}</small>
        <Field label="Contact"><input name="contact" defaultValue={supplier.contact}/></Field>
        <Field label="Accreditation"><input name="accreditation" defaultValue={supplier.accreditation}/></Field>
        {state.role === "Administrator" && <button className="button secondary">Save supplier</button>}
      </form>)}</div>
      {state.role === "Administrator" && <form className="subform" onSubmit={event => void submit(event, "newSupplier")}>
        <h3>Add supplier</h3>
        <div className="form-grid">
          <Field label="Name"><input name="name" required/></Field>
          <Field label="Location"><input name="location" required/></Field>
          <Field label="Contact"><input name="contact" required/></Field>
          <Field label="Accreditation"><input name="accreditation" required/></Field>
        </div>
        <button className="button primary">Add supplier</button>
      </form>}
    </section>
    <InlineError message={error}/>
    <section className="panel">
      <h2 className="panel-title">Recent activity</h2>
      <div className="activity-list">{state.activity.slice(0, 18).map(activity => <div key={activity.id}>
        <strong>{activity.action}</strong><span>{activity.actor} / {dateText(activity.at)}</span>{activity.reason && <small>{activity.reason}</small>}
      </div>)}</div>
    </section>
  </>;
}
